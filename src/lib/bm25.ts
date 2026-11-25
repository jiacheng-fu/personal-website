/* BM25 retrieval, written to be watched.
 *
 * This is the retrieval stage of the RAG section, and the section's whole
 * point is that a visitor can see the machinery - so every function here
 * returns its working: which query terms survived tokenization, each term's
 * rarity weight, and how much each term contributed to each chunk's score.
 * Nothing is hidden inside the ranker that the UI cannot show.
 *
 * BM25 over embeddings is a deliberate choice, not a fallback: for a corpus
 * of a dozen resume chunks it retrieves just as well, runs in microseconds
 * with no model download, and - unlike cosine distance between 384-float
 * vectors - a human can audit every score by eye.
 */
import corpus from "../data/corpus.json";

export interface Chunk {
  id: number;
  section: string;
  title: string;
  dates: string;
  text: string;
}

export interface QueryToken {
  raw: string; // as typed
  term: string; // stemmed form used for matching ("" if dropped)
  stopword: boolean;
  /* Brian's own name (or a pronoun standing in for it). Matchable, but at a
     fraction of a real term's weight - see SOFT_WEIGHT. */
  soft?: boolean;
}

export interface TermContribution {
  term: string;
  idf: number;
  tf: number; // occurrences of the term in this chunk
  weight: number; // 1 for the visitor's own words, less for expansions
  score: number; // this term's share of the chunk's total
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  boost: number; // 1 for the resume; more for a note the visitor just fed in
  /* at least one word the visitor typed is in this chunk - see retrieve() */
  grounded: boolean;
  contributions: TermContribution[]; // only terms that matched, best first
}

export interface Retrieval {
  /* false when nothing survived tokenization - "?", "!!!", an emoji, five
     copies of the word "the". Not a question the archive missed; not a
     question at all, and answered as such rather than with a refusal about
     Brian's documents. */
  understood: boolean;
  tokens: QueryToken[];
  /* terms added by query expansion (stems the corpus actually contains) */
  expanded: string[];
  /* the archive's spelling of what the visitor typed: a typo's correction, or
     two words read as one ("desk stats") - these stand for typed words */
  corrected: string[];
  /* every chunk, corpus order - the UI shows the whole field lighting up */
  scored: ScoredChunk[];
  /* the ones that go into the prompt, best first */
  top: ScoredChunk[];
}

/* Words that carry no signal in a "tell me about Brian" question. Kept small
   and honest - an aggressive list starts eating real terms ("do", "did" stay
   out but "does he know C" must keep "know"... no, "know" isn't here).

   Question words live here too: no chunk contains "where". They are dropped
   as match terms and re-enter through INTENT below, which is the difference
   between "where is he" pulling the location vocabulary and pulling nothing. */
const STOPWORDS = new Set(
  ("a an and about are as at be but by can could did do does for from had has have her how i if in is it its me my of on or should " +
    "s so t tell that the their them they this to was we what when where which who whose why will would with you your " +
    /* asking about now: see RECENCY */
    "now today currently lately recently nowadays doing up " +
    /* words that only ever collided (QA, 2026-11-25): "is he INTO sports"
       found "got into programming", "a morning PERSON" found "third-person
       movement", "which city does he CALL home" found "1,000-call/month",
       "has he USED kubernetes" found "used to play Valorant" */
    "into person call use used uses using still outside just professional " +
    /* filler a visitor types that carries no subject: "who EVEN is he" */
    "even really actually basically literally lol pls please hey hi hello yo bro um uh ok okay " +
    "anything something everything nothing since but got single all time like take taken took technical " +
    /* a lone digit is arithmetic or a version suffix, never the subject:
       "solve 2 + 2" used to find Valorant's "Immortal 2" (2026-11-25) */
    "0 1 2 3 4 5 6 7 8 9").split(" ")
);

/* Words that ask about the present. They match nothing in the archive - the
   documents are all past tense - but they are the strongest signal there is
   that a visitor's note, not a resume bullet, is the passage wanted. So they
   drop out as terms and come back as the freshness prior below. */
const RECENCY = new Set("now today currently lately recently nowadays doing".split(" "));

/* Brian's name is not a stopword - it is a term whose rarity the archive
   itself destroys. Every chunk is about him, so "brian" selects nothing and
   his name x4 in the contact card used to outscore real matches. Deleting it
   from queries was worse: "where is brian" tokenized to NOTHING and the
   machine answered a question it could see with an archive miss.
   So: kept, indexed, matchable - demoted to SOFT_WEIGHT beside a real term,
   and back at full weight when the question contains nothing else, because
   then his name is genuinely all the visitor gave us. Pronouns fold into it,
   which is the cheapest coreference that works: "where does HE live" - and so
   does the typo everyone makes for it. */
const NAME = "brian";
const NAMES = new Set("brian brians brain fu jiacheng he him his himself".split(" "));
const SOFT_WEIGHT = 0.2;

/* Suffix-stripping just strong enough to make "interned" meet "intern" and
   "compilers" meet "compiler". A real Porter stemmer buys nothing here and
   its stems ("compil") would look like bugs in a UI built to be read. */
function stem(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w];
  /* "embeddings": the plural comes off first, then the -ing, so it meets
     "embedding" (one rule per word used to leave them apart) */
  if (w.length > 6 && w.endsWith("ings")) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("ing")) w = restoreE(w.slice(0, -3));
  else if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 3 && w.endsWith("ed")) w = restoreE(w.slice(0, -2));
  else if (w.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}
/* Porter's step 1b, the one piece of it worth having: "graduated" and
   "graduating" lose their ending and land on "graduat", which never met
   "graduate" - so a visitor's note saying Brian graduated was invisible to
   "when does he graduate" (QA, 2026-11-25). The same for created, updated,
   automated, troubled, sized. */
const restoreE = (w: string) =>
  /(?:at|bl|iz)$/.test(w) ? w + "e" : /([bdfgmnprt])\1$/.test(w) ? w.slice(0, -1) : w;
/* ...and the doubled consonant before -ed/-ing: "shipped" and "running" left
   "shipp" and "runn", which met nothing (QA, 2026-11-25). */

/* Irregular past forms, to their base: "ran" never met "run", "wrote" never
   met "write". Short and common only; the synonym table covers the rest. */
const IRREGULAR: Record<string, string> = {
  ran: "run", won: "win", wrote: "write", taught: "teach", bought: "buy", led: "lead", went: "go",
  gone: "go", ate: "eat", eaten: "eat", drove: "drive", driven: "drive", spoke: "speak", spoken: "speak", knew: "know",
  known: "know", grew: "grow", grown: "grow", began: "begin", begun: "begin", chose: "choose", chosen: "choose",
  felt: "feel", kept: "keep", met: "meet", paid: "pay", sold: "sell", sent: "send", spent: "spend", took: "take",
  taken: "take", thought: "think", told: "tell", understood: "understand", lost: "lose", flew: "fly", swam: "swim",
  sang: "sing", fought: "fight", caught: "catch", brought: "bring", sought: "seek", held: "hold", stood: "stand",
};

function words(s: string): string[] {
  /* Unicode letters, not just a-z: a visitor's note may be in any language or
     may simply contain a name with an accent, and a class of [a-z] silently
     indexes "Jos\u00e9" as nothing at all.

     Dots and + and # stay inside the token so "c++", "c#", "next.js", "U.S."
     and "3.87" survive the split - and are then normalised: a dot inside a
     word carries no meaning the two sides don't already have, so "next.js"
     and "nextjs", "u.s." and "us", index and match as one term. Numbers keep
     their dots, because 3.87 is not 387. */
  /* A thousands separator is part of the number: "$2,500" is 2500, not a "2"
     and a "500". Split, the "2" matched "solve 2 + 2 for me" to the Mesa
     entry ($2,500 ceiling) as evidence (2026-11-25). */
  /* "by himself" is not his name twice: it means solo, and the archive says
     "solo" and "sole author" (2026-11-25, "has he built anything by himself"
     was quoting the one team build). */
  const joined = s
    /* compatibility forms (full-width Ａ, ligatures) to plain letters, and
       the invisible characters a pasted or mischievous question can carry -
       zero-width spaces split "skills" into nothing anyone can match */
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "")
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/\b(?:by (?:him|my|your)self|on (?:his|my|your) own)\b/g, "solo")
    .replace(/\bopen[- ]source\b/g, "opensource")
    .replace(/\bspring ?boot\b/g, "springboot")
  return (joined.match(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu) ?? []).flatMap((w) => {
    if (CJK.test(w)) return cjk(w);
    const t = w.replace(/\.+$/, "");
    return [/^[\d.]+$/.test(t) ? t : t.replace(/\./g, "")];
  });
}

/* Chinese, Japanese and Korean have no spaces, so a whole sentence came out
   as ONE word: "他的GPA是多少" matched nothing, not even its "GPA", and a
   visitor's Chinese note could never be found by a Chinese question (QA,
   2026-11-25). Latin runs inside are split off and kept whole; the CJK runs
   become overlapping character pairs - the standard way to search text with
   no word breaks - so "布莱恩喜欢吃什么" meets a note "布莱恩喜欢吃饺子" on
   布莱, 莱恩, 恩喜, 喜欢, 欢吃. */
/* Chinese words a visitor asks about Brian with -> the archive's English */
const ZH_EN: [string, string][] = [
  ["签证", "visa sponsorship"], ["担保", "sponsorship"], ["绿卡", "green card permanent"], ["工作", "job work"], ["实习", "internship intern"],
  ["毕业", "graduate"], ["大学", "university"], ["学校", "school university"], ["专业", "major"], ["课程", "coursework"], ["成绩", "gpa"], ["绩点", "gpa"],
  ["联系", "contact email"], ["邮箱", "email"], ["邮件", "email"], ["电话", "phone"], ["技能", "skills"], ["编程", "programming code"], ["语言", "languages"],
  ["项目", "projects"], ["经验", "experience"], ["公司", "companies"], ["爱好", "hobbies"], ["游戏", "games"], ["电影", "movie"], ["音乐", "music"],
  ["喜欢", "favorite"], ["最爱", "favorite"], ["颜色", "color"], ["食物", "foods"], ["吃", "foods eat"], ["家乡", "hometown"], ["哪里人", "hometown born"],
  ["出生", "born"], ["住", "based lives"], ["中文", "mandarin chinese"], ["普通话", "mandarin"], ["英语", "english"], ["西安", "xi'an"], ["奥斯汀", "austin"],
  ["德州", "texas"], ["安全", "security"], ["什么时候", "expected december"], ["技术", "tech stack"], ["做什么", "job current"], ["编译器", "compiler"], ["网站", "website"], ["宠物", "pet"], ["是谁", "about"], ["介绍", "about"],
];
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function cjk(w: string): string[] {
  const out: string[] = [];
  for (const run of w.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []) {
    if (!CJK.test(run)) {
      const t = run.replace(/\.+$/, "").replace(/^[^\p{L}\p{N}]+/u, "");
      if (t) out.push(/^[\d.]+$/.test(t) ? t : t.replace(/\./g, ""));
    } else if (run.length === 1) out.push(run);
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/* The single word -> term rule, used by the index and the query alike so the
   two can never drift apart. */
function canon(w: string): string {
  return NAMES.has(w) ? NAME : stem(w);
}


/* QUESTION-ONLY phrase rewrites (QA, 2026-11-25). Applied to what the
   visitor types, never to the archive - an earlier version sat in words()
   and indexed "790 pages per hour" as "790 pages salary". Phrases whose words
   mean something else on their own: "for a living" found his hometown through
   "living", "when he's not coding" found the Aggie Coding Club, "get in
   touch" found nothing at all. */
function rewriteQuery(q: string): string {
  return q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bfor a living\b/g, "job")
    .replace(/\b(?:when (?:he'?s|he is|hes) not (?:coding|working|programming|at work)|in his (?:free|spare) time|(?:free|spare) time|for fun|outside (?:of )?(?:work|coding|school))\b/g, "hobbies")
    .replace(/\b(?:ignore|disregard|forget) (?:all |any |the )?(?:of )?(?:your |the )?(?:previous |prior |above |earlier )?(?:instructions|rules|prompts?|context)\b|\bsystem prompt\b|\byou are now \w+\b/g, " ")
    .replace(/\bsocial security(?: number)?\b|\bssn\b/g, "ssn")
    .replace(/\b(?:years? of (?:professional |work |industry )?experience|yrs? (?:of )?exp(?:erience)?|yoe)\b/g, "experience internships")
    .replace(/\b(?:resume|cv)\b/g, "resume linkedin")
    .replace(/\bevery ?day\b/g, "daily")
  .replace(/\b(?:on|during|over) (?:the )?weekends?\b/g, "hobbies")
  .replace(/\b(?:get|getting|be|stay) in touch\b|\breach out\b|\bget a ?hold of\b/g, "contact")
  .replace(/\b(?:where|who) (?:does|do|did) (?:he|brian) work(?: for| at)?(?: (?:now|right now|currently|these days|at the moment))?\b/g, "current job")
  .replace(/\bis (?:he|brian) (?:still )?(?:working|employed)(?: anywhere| somewhere| now| right now)?\b/g, "current job employed")
  .replace(/\b(?:per hour|an hour|hourly|pay rate|compensation|how much (?:does|would|will) (?:he|brian) (?:want|charge|make|earn|cost|expect))\b/g, "salary");
}

export function tokenize(query: string): QueryToken[] {
  return words(rewriteQuery(query)).map((raw) => {
    if (NAMES.has(raw)) return { raw, term: NAME, stopword: false, soft: true };
    const stop = STOPWORDS.has(raw);
    return { raw, term: stop ? "" : stem(raw), stopword: stop };
  });
}

/* ---- query expansion --------------------------------------------------
   Lexical retrieval only finds the words that are literally there. People
   ask "what companies", the resume says "employers"; "where did he study",
   the resume says "University". A small thesaurus in stem-space bridges
   that in general, for every question, and at a reduced weight so the
   visitor's own words always outrank the guesses. Everything added is shown
   on the glass. Stems, not words: they must match what stem() produces. */
const SYNONYMS: string[][] = [
  ["company", "employer", "job", "work", "intern", "internship", "career", "experience", "position", "role", "employ", "engineer", "exp", "yoe",
   /* a recruiter's vocabulary, which the resume answers without using */
   "hire", "hiring", "recruit", "candidate", "resume", "cv", "qualified", "background", "history"],
  ["project", "build", "built", "made", "make", "create", "develop", "app", "game", "platform", "ship", "side", "personal", "portfolio",
   /* the two hackathons are named on the resume and called "hackathon" nowhere */
   "hackathon", "howdyhack", "tamuhack"],
  ["school", "study", "university", "college", "degree", "graduate", "education", "gpa", "major", "class", "course", "coursework", "student", "grad", "graduation",
   "year", "senior", "junior", "sophomore", "freshman", "undergrad", "undergraduate", "tamu", "aggie", "aggies"],
  ["skill", "know", "use", "tool", "stack", "technology", "language", "framework", "proficient", "familiar", "tech", "code",
   /* "impressive" and "best" are deliberately absent: they attach to whatever
      the visitor is asking about ("his most impressive PROJECT") and pulling
      them into the skills vocabulary answered that question with a list of
      programming languages. */
   "good", "strong", "strength", "talent", "expert", "specialty", "strongest", "comfortable"],
  ["contact", "email", "reach", "phone", "linkedin", "github", "message"],
  /* No "live" here on purpose. It is a real word in the About card ("Brian
     lives in Austin") and a visitor who types it matches that directly - but
     as an EXPANSION of "where" it also drags in the Wild West chunk's "live
     multiplayer" and "live-service", and a briefing has only four slots. */
  ["location", "city", "based", "austin", "texas", "address", "where",
   /* a visitor's note about where he is says "moved", "staying", "flew to" -
      never "location". Without these a note reading "Brian moved to Seattle"
      was invisible to "where does he live", which is precisely the conflict
      the notes are supposed to win. */
   "moved", "moving", "relocated", "staying", "living", "home", "town"],
  ["ai", "llm", "ml", "machine", "model", "learn", "openrouter", "intelligence"],
  ["security", "secure", "vulnerable", "exploit", "owasp", "appsec", "hack", "hacker",
   "leak", "leaking", "breach", "exposure", "vulnerability", "authorization"],
  /* what a customer is called inside a multi-tenant system */
  ["tenant", "customer", "client"],
  /* money, which the archive talks about as costs, ceilings and tiers */
  ["budget", "cost", "ceiling", "cheap", "price", "money", "spend", "quota", "afford", "frugal"],
  /* Mesa, which the archive never calls a startup */
  ["startup", "founder", "founded", "founding", "cofounder"],
  ["daily", "everyday"],
  ["gamer", "gaming", "game", "video", "shooter", "esports"],
  ["surprising", "fun", "interesting", "trivia", "quirk", "random"],
  /* the box itself, by whatever the visitor calls it */
  ["machine", "box", "bot", "chatbot", "assistant", "terminal", "rag", "search", "thing"],
  ["user", "users", "customer", "adoption"],
  ["music", "artist", "musician", "song", "rapper", "band", "album", "listen"],
  ["movie", "film", "show", "tv", "anime", "series", "watch", "cinema"],
  ["website", "site", "portfolio", "webpage", "page"],
  ["impressive", "proudest", "proud", "accomplishment", "achievement"],
  ["compiler", "llvm", "backend", "isa", "npu", "hardware", "chip", "silicon"],
  ["database", "sql", "postgresql", "postgres", "dynamodb", "schema", "data"],
  /* "does he test his code" has to reach the passage that says "unit tests"
     and "regression", not stop at the skills card that says "TOCTOU testing" */
  ["test", "testing", "qa", "unit", "regression", "coverage", "verified", "probe", "invariant"],
  /* paradigms the resume names only by the language that implements them */
  ["functional", "haskell", "paradigm", "immutable", "declarative"],
  ["solo", "alone", "sole", "independent", "independently", "single-handedly", "only", "lone"],
  ["oop", "object", "inheritance", "polymorphism", "encapsulation"],
  ["devops", "ci", "cd", "pipeline", "docker", "deploy", "infrastructure", "automated", "git"],
  /* work authorisation, which a resume states in three words and nobody asks
     for in those three words */
  ["visa", "sponsorship", "sponsor", "citizen", "citizenship", "resident", "permanent", "authorized", "eligible", "status", "american",
   "green", "greencard"],
  /* availability: the archive says "open to 2027 internships"; visitors ask
     "is he looking", "is he available", "can we hire him" */
  ["open", "available", "availability", "looking", "seeking", "opportunity", "opportunities", "hire", "hiring"],
  /* Everyday vocabulary. Inert against the resume - none of these words is in
     it - and that is exactly the point: expansion only ever adds a term the
     corpus actually contains, so this table lies dormant until a visitor
     feeds in a note that introduces the words, and then it bridges "does he
     have a pet" to the cat they just told the machine about. */
  ["pet", "cat", "dog", "animal", "kitten", "puppy", "adopted"],
  ["eat", "eating", "food", "lunch", "dinner", "breakfast", "meal", "hungry", "restaurant", "subway", "coffee",
   /* the one food the archive itself knows about (Favorites) */
   "dessert", "ice", "cream", "snack", "noodle", "barbecue", "carb"],
  ["family", "wife", "husband", "partner", "girlfriend", "boyfriend", "married", "brother", "sister", "parent", "mom", "dad"],
  ["hobby", "hobbies", "enjoy", "favorite", "favourite", "interest", "weekend", "pastime"],
  ["travel", "trip", "vacation", "visit", "flight", "flying", "driving"],
  ["sick", "ill", "hospital", "injured", "hurt", "tired", "asleep", "sleeping"],
];
/* Built through stem(), not written in stem-space by hand. The table above
   reads as English and cannot drift: "devops" was silently dead here for a
   while because the query stems it to "devop" and the entry said "devops". */
/* Written as ordinary words and normalised here through the same stemmer the
   index uses. Hand-maintaining the table in stem-space looked tidy and was a
   quiet source of dead entries: "adopted" can never match, because the corpus
   indexed that word as "adopt", and "vulnerable" never met the resume's
   "vulnerabilities" for the same reason. Now an entry is written the way a
   person would say it and lands wherever the stemmer puts it. */
const EXPAND = new Map<string, string[]>();
for (const group of SYNONYMS) {
  const g = [...new Set(group.map(stem))];
  for (const t of g)
    EXPAND.set(t, [...new Set([...(EXPAND.get(t) ?? []), ...g.filter((x) => x !== t)])]);
}

/** Is this term anywhere in the index? For diagnostics: a thesaurus entry the
 *  corpus never contains can only ever be dead weight, unless it is there to
 *  meet a word a visitor's note will introduce. */
export const indexHas = (term: string): boolean => docTerms.some((tf) => tf.has(term));
/** A text's terms by the index's own rule (stems, names, no stopwords), for
 *  matching a query to single sentences (lib/extract.ts). */
export const termsOf = (text: string): Set<string> =>
  new Set(words(text).filter((w) => !STOPWORDS.has(w)).map(canon));

/** Every distinct term the thesaurus can produce - scripts/rag-eval.ts checks
 *  them against the corpus so a group that bridges to nothing is visible. */
export const expansionTerms = (): string[] => [...EXPAND.keys()].sort();
export const synonymGroups = (): string[][] => SYNONYMS.map((g) => [...new Set(g.map(stem))]);

const EXPANSION_WEIGHT = 0.45;
/* Roughly "in no more than a quarter of the archive". Expressed as an idf so
   it keeps meaning the same thing as the corpus grows with visitor notes.
   Below it, a word's neighbours are still added - "what has he built" has
   nothing else to go on and must not be refused - but quietly, so they
   cannot outvote the rare word the visitor typed alongside them. */
const EXPAND_MIN_IDF = 1;
const COMMON_EXPANSION_WEIGHT = 0.18;
/* A question word is the faintest signal of the three: the visitor typed it,
   but they typed it about the shape of the answer, not about its content.
   "Where has he worked" is a question about employers that happens to start
   with "where", and at full expansion weight the location vocabulary won it
   for the contact card. */
const INTENT_WEIGHT = 0.3;

/* What a question word is actually asking for. The value is a stem that lives
   in a SYNONYMS group above, so an interrogative borrows that whole group
   through the ordinary expansion path: shown on the glass, carried at
   expansion weight, never outranking a word the visitor actually typed. */
const INTENT: Record<string, string> = { where: "location" };

/* What a question with no content in it at all is taken to be asking. "Who is
   brian", "tell me about him", "???" - the archive answers the question every
   archive answers first. Note this is NOT INTENT["who"]: "who does he work
   for" is an employment question, and routing every "who" to the contact card
   sent it to the wrong chunk. */
const IDENTITY_SEED = "contact";

/* A note a visitor fed in seconds ago is the newest document in the archive
   and the only one that can speak about now, so when it matches at all it
   should be hard to bury under a resume bullet from 2024. The multiplier is
   printed next to its score - nothing here happens off-screen. */
export const VISITOR_BOOST = 1.75;

/* And when the question gives BM25 nothing to rank with - "where is brian",
   "what's he up to", his name and grammar and nothing else - every chunk
   holds his name equally and the scores are all noise. The archive then falls
   back to the one ordering it does have: how recently a document entered it.
   The notes a visitor fed in are the newest things it knows and the only ones
   that can speak about now, so they ride into the briefing on freshness
   alone, newest first. Resume chunks have no such prior; the overview and the
   contact card win those questions on their own terms. */
const FRESH_PRIOR = 1.5;
/* "where is he RIGHT NOW" is not a tie to be broken, it is a question the
   resume cannot answer at all. An explicit word about the present doubles the
   prior, which is enough to put the note above the contact card. */
const RECENCY_PRIOR = 3;

/* ---- index, built once at module load ---- */
const K1 = 1.2;
const B = 0.75;

export const chunks: Chunk[] = corpus.chunks;

const docTerms: Map<string, number>[] = chunks.map((c) => {
  const tf = new Map<string, number>();
  /* titles and section names are part of the document - "contact" and "Axle"
     live in titles, and a chunk should be findable by its own name */
  for (const w of words(`${c.section} ${c.title} ${c.text}`)) {
    const t = canon(w);
    if (!STOPWORDS.has(w)) tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
});
const docLen = docTerms.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
let avgLen = docLen.reduce((a, b) => a + b, 0) / docLen.length;

/** Add a document at runtime - a visitor's note, torn into one fragment and
 *  indexed exactly like the resume's. Lives only in this page's memory. */
export function addChunk(section: string, title: string, text: string): Chunk {
  const chunk: Chunk = { id: chunks.length, section, title, dates: "", text };
  chunks.push(chunk);
  const tf = new Map<string, number>();
  /* "Visitor note #3" is a label this code wrote, not something anyone said,
     and indexing its serial made "-1" retrieve note #1. The words stay - a
     visitor may well ask what the note said - the number goes. */
  for (const w of words(`${section} ${title.replace(/#\d+/g, "")} ${text}`)) {
    const t = canon(w);
    if (!STOPWORDS.has(w)) tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  docTerms.push(tf);
  docLen.push([...tf.values()].reduce((a, b) => a + b, 0));
  avgLen = docLen.reduce((a, b) => a + b, 0) / docLen.length;
  idfCache = new Map(); // every term in the corpus just got a little less rare
  return chunk;
}

/* Document frequency is a property of the index, not of the query, so it is
   memoised and thrown away only when a note changes the index. Recomputing it
   inside the per-chunk loop made scoring quadratic in the corpus - invisible
   at 13 chunks, and a stutter a visitor would feel after feeding in a few
   dozen notes. */
let idfCache = new Map<string, number>();

/* how much a typo-corrected word counts, against 1 for a word typed right */
const FUZZY_WEIGHT = 0.85;
/* Shorter words are not corrected: a 4-5 letter word missing from the
   archive is far likelier a real word it just does not use than a typo -
   "live" snapped to "line", "world" to "word", "solve" to "solving" and
   "pizza" found a project. The typos that matter are long: internship,
   python, valorant, interstellar. */
const FUZZY_MIN = 6;

/** Every term in the archive right now, visitor notes included. */
function vocabulary(): Set<string> {
  const v = new Set<string>();
  for (const tf of docTerms) for (const k of tf.keys()) v.add(k);
  return v;
}

/** The archive's closest words to a typo: one edit up to 8 letters, two from
 *  9, same first letter. Optimal string alignment distance,
 *  so a swapped pair ("pyhton") is one edit. Ties all count; at most two. */
function nearest(t: string, vocab: Set<string>): string[] {
  const max = t.length >= 9 ? 2 : 1;
  let best = max + 1;
  let out: string[] = [];
  for (const v of vocab) {
    if (v[0] !== t[0] || Math.abs(v.length - t.length) > max || v.length < FUZZY_MIN - 1) continue;
    const d = osa(t, v, max);
    if (d < best) {
      best = d;
      out = [v];
    } else if (d === best) out.push(v);
  }
  return best <= max ? out.slice(0, 2) : [];
}
function osa(a: string, b: string, cap: number): number {
  const m = a.length;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > cap) return cap + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

function idf(term: string): number {
  let v = idfCache.get(term);
  if (v === undefined) {
    const n = docTerms.filter((tf) => tf.has(term)).length;
    /* Textbook BM25 idf, floored - NOT the Lucene variant with a +1 inside
       the log. The difference decides this archive.
    
       Every chunk here is a resume bullet about one person, so the corpus is
       vocabulary-poor in exactly the words people ask with: "work" is in six
       of thirteen chunks, "experience" in five. The +1 form floors those at
       ~1.1, a third of what a genuinely rare term earns, and once query
       expansion turns one typed "worked" into nine employment synonyms their
       floored idfs sum to four points of nothing-in-particular - enough to
       bury "llms", the one word the visitor actually cared about, under three
       chunks that merely mention having a job.
    
       Unfloored, a term in half the corpus is worth ~0.14 and a term in one
       chunk ~2.1: fifteen times the pull, which is the truth of the matter.
       The floor is only there to keep a ubiquitous term from going negative
       and subtracting evidence from a chunk that does contain it. */
    v = Math.max(0.05, Math.log((chunks.length - n + 0.5) / (n + 0.5)));
    idfCache.set(term, v);
  }
  return v;
}

/* Below this best-chunk score the evidence is too thin to brief the model -
   the section serves a canned refusal instead and spends zero GPU cycles.
   Calibrated against scripts/rag-eval.ts, which is where the number is kept
   honest: across ~110 labelled questions, answerable ones land at 1.5 and up
   (the median is near 4), questions the resume genuinely cannot answer land
   at 0, and the grazes in between - one common word landing in a long chunk -
   sit under 0.8. Change this and run the eval; several cases sit close enough
   to the line to tell you immediately if it moved the wrong way. */
export const MIN_EVIDENCE = 0.8;

/* Two passages that say the same thing are worth one slot, not two. A visitor
   who feeds a note twice - or hits Enter twice, or rephrases and re-feeds -
   used to spend three of the four briefing slots on one sentence, leaving the
   model with nothing else to answer from. Overlap is measured on indexed
   terms rather than raw text so a re-typed note counts as the same note.
   Deduplication touches the BRIEFING only: the field still shows every
   fragment and its real score, because they are all genuinely in there. */
const NEAR_DUPLICATE = 0.85;

function nearDuplicate(a: Chunk, b: Chunk): boolean {
  const A = docTerms[a.id];
  const B = docTerms[b.id];
  if (!A || !B) return false;
  let shared = 0;
  for (const t of A.keys()) if (B.has(t)) shared++;
  const union = A.size + B.size - shared;
  return union > 0 && shared / union >= NEAR_DUPLICATE;
}

/** The gate the section spends GPU on. Both halves matter: enough score, and
 *  a reason to believe it that came from the visitor rather than from the
 *  thesaurus. Below either, the answer is a canned refusal and no tokens are
 *  sampled at all. */
export function hasEvidence(r: Retrieval): boolean {
  return r.understood && r.top.some((s) => s.score >= MIN_EVIDENCE && s.grounded);
}

export function retrieve(query: string, k = 3): Retrieval {
  const tokens = tokenize(query);
  const own = [...new Set(tokens.filter((t) => t.term && !t.soft).map((t) => t.term))];
  const soft = [...new Set(tokens.filter((t) => t.soft).map((t) => t.term))];

  /* the visitor's words at full weight, their neighbours at less - and only
     neighbours the corpus actually contains, so nothing phantom is shown */
  const weights = new Map<string, number>();
  for (const t of own) weights.set(t, 1);
  for (const t of soft) if (!weights.has(t)) weights.set(t, own.length ? SOFT_WEIGHT : 1);

  const expanded: string[] = [];
  const typed = new Set([...own, ...soft]);
  /* Terms no word of the visitor's reached - added below by a question word's
     intent, or by the identity fallback. They may rank; they may not be the
     only reason a chunk is called evidence. See `grounded`. */
  const inferred = new Set<string>();
  const corrected_zh: string[] = [];
  const add = (term: string, weight: number) => {
    if (typed.has(term) || !docTerms.some((tf) => tf.has(term))) return;
    const had = weights.get(term);
    if (had === undefined) expanded.push(term);
    /* a term two different words both reach for keeps the better claim */
    if (had === undefined || had < weight) weights.set(term, weight);
  };
  /* Expansion is a bridge for a word the archive does not use, not an
     amplifier for one it uses constantly. "Worked" is in half these chunks:
     the archive already knows what it means, and expanding it into nine
     employment synonyms buried "llms" - the one word in the question that
     actually narrowed anything - under three chunks that merely mention
     having a job. A word this rare-or-rarer still gets its neighbours, which
     is what keeps "school" reaching University and "classes" reaching
     coursework rather than to OWASP vulnerability classes. */
  for (const t of [...own, ...soft]) {
    const common = docTerms.some((tf) => tf.has(t)) && idf(t) < EXPAND_MIN_IDF;
    for (const x of EXPAND.get(t) ?? []) add(x, common ? COMMON_EXPANSION_WEIGHT : EXPANSION_WEIGHT);
  }
    /* A Chinese question reaching the English archive: the words visitors
     actually ask about, from a small table, at expansion weight (Brian is a
     native Mandarin speaker; so are some of the people he will send here).
     Typed in Chinese, so they count as the visitor's own words. */
  const zh = query.normalize("NFKC");
  if (CJK.test(zh)) {
    for (const [cn, en] of ZH_EN) if (zh.includes(cn)) for (const e of en.split(" ")) { add(stem(e), EXPANSION_WEIGHT * 2); corrected_zh.push(stem(e)); }
  }
  /* FUZZY: a word the archive does not contain is probably a typo of one it
     does - "intenship", "pyhton", "valorent", "interstelar". Each is matched
     to the archive's nearest words within one slip of the finger (two for a
     long word; the first letter has to agree, and swapped neighbours count as
     one slip), at a little under full weight, and they bring their synonyms.
     And two words typed apart that the archive writes as one ("desk stats",
     "java script", "git hub") are read together. Both show on the glass as
     +TERMS like any expansion, so a correction is never invisible. */
  const vocab = vocabulary();
  const corrected: string[] = [...corrected_zh];
  for (const t of own) {
    if (vocab.has(t) || t.length < FUZZY_MIN || /^[\d.]+$/.test(t) || CJK.test(t)) continue;
    for (const v of nearest(t, vocab)) {
      add(v, FUZZY_WEIGHT);
      corrected.push(v);
      for (const x of EXPAND.get(v) ?? []) add(x, FUZZY_WEIGHT * EXPANSION_WEIGHT);
    }
  }
  const raws = tokens.filter((t) => !t.stopword).map((t) => t.raw);
  for (let i = 0; i + 1 < raws.length; i++) {
    const joinedTerm = stem(raws[i] + raws[i + 1]);
    if (vocab.has(joinedTerm)) {
      add(joinedTerm, 1);
      corrected.push(joinedTerm);
    }
  }
  /* question words, dropped as terms, re-entering as vocabulary. A question
     that is nothing but his name ("tell me about brian") is read as the one
     every archive answers first - who is this - so it borrows "who"'s intent
     and the identity cards rank on their own terms instead of losing to
     whatever the freshness prior drags in. */
  const seeds = tokens.map((t) => INTENT[t.raw]).filter(Boolean);
  if (!seeds.length && !own.length && soft.length) seeds.push(IDENTITY_SEED);
  for (const seed of seeds) {
    for (const x of [seed, ...(EXPAND.get(seed) ?? [])]) {
      const before = weights.size;
      add(x, INTENT_WEIGHT);
      if (weights.size > before) inferred.add(x); // nothing typed reached it
    }
  }

  /* nothing to rank with, or an explicit question about now */
  const asksNow = tokens.some((t) => RECENCY.has(t.raw));
  const prior = asksNow ? RECENCY_PRIOR : own.length === 0 ? FRESH_PRIOR : 0;
  const notes = chunks.filter((c) => c.section === "Visitor");
  const scored: ScoredChunk[] = chunks.map((chunk, i) => {
    const boost = chunk.section === "Visitor" ? VISITOR_BOOST : 1;
    const contributions: TermContribution[] = [];
    let score = 0;
    for (const [term, weight] of weights) {
      const tf = docTerms[i].get(term) ?? 0;
      if (!tf) continue;
      const w = idf(term);
      /* the boost rides on each term's share, so the contributions still add
         up to the score the UI prints */
      const part = (boost * weight * w * tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen[i] / avgLen)));
      score += part;
      contributions.push({ term, idf: w, tf, weight, score: part });
    }
    /* Synonyms are alternatives for one idea, so a card that happens to use
       six of them must not score six times: "is he still at subway" expanded
       subway into the food words, and the Favorites card's ice, cream, food,
       noodle, barbecue and carbs added up to more than the visitor's own note
       that literally says Subway (QA, 2026-11-25). Together, expansion terms
       may add at most twice their single best match. Scaled,
       not dropped, so the parts still sum to the score on the glass. */
    const viaThesaurus = contributions.filter((c) => !typed.has(c.term) && !corrected.includes(c.term));
    if (viaThesaurus.length > 1) {
      const sum = viaThesaurus.reduce((a, c) => a + c.score, 0);
      const cap = 2 * Math.max(...viaThesaurus.map((c) => c.score));
      if (sum > cap) {
        const f = cap / sum;
        for (const c of viaThesaurus) {
          score -= c.score * (1 - f);
          c.score *= f;
        }
      }
    }
    /* Is any of this score traceable to something the visitor said? Their own
       words count, and so does anything the thesaurus reached FROM one - "and
       school?" is answered entirely by university/college/degree and is a
       perfectly good question. What does not count is a term only a question
       word's intent introduced: "who won the world cup" once matched nothing,
       expanded "who" into the contact vocabulary, and scored the contact card
       3.76 on email/reach/github alone - a confident answer assembled out of
       words nobody said. Inference may rank; it may not, by itself, be the
       reason a passage is called evidence. */
    let grounded = contributions.some((c) => !inferred.has(c.term));
    /* the freshness prior - the UI flags these rows FRESH so a score the
       terms alone cannot explain is never a mystery. It is a decision, not a
       graze, so it grounds the chunk it lands on. */
    if (prior && chunk.section === "Visitor") {
      score += prior * Math.pow(0.8, notes.length - 1 - notes.indexOf(chunk));
      grounded = true;
    }
    contributions.sort((a, b) => b.score - a.score);
    return { chunk, score, boost, grounded, contributions };
  });

  const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  /* The overview chunk - every employer, project and school on one card -
     always rides along in the briefing, whatever the question. Retrieval
     picks the detail; the overview guarantees the model never loses the
     big picture. It is sorted in by score like any other chunk, so a zero
     score on it cannot masquerade as evidence. */
  const overview = scored.find((s) => s.chunk.section === "Overview");
  /* When a visitor's note has out-ranked everything, the briefing carries one
     fewer of Brian's older passages. Not to hide them - the note leads, and
     the model is told plainly that the older ones may be stale - but because
     a 25-character note arguing with 400 characters of confident résumé prose
     loses that argument on sheer mass. "Where is brian", against a note
     saying he is at a Subway, was briefing the contact card ("Brian lives in
     Austin, Texas") AND the education card ("College Station, TX") and coming
     back with Austin. Trimming the weakest of them costs a question nothing:
     if a passage were carrying the answer it would not be ranked last. */
  /* The best visitor note in contention, promoted to the front of the queue.
     Promoting it FIRST is what makes the trim safe: taking one fewer passage
     to give a note room, without also guaranteeing the note a seat, dropped
     the note itself - "Brian moved to Seattle" fell out of its own briefing
     in favour of the Austin card it was supposed to correct. */
  const contenders = ranked.slice(0, Math.max(1, k - 1));
  const note = contenders.find((s) => s.chunk.section === "Visitor");
  const room = Math.max(1, k - (note ? 2 : 1));
  const queue = note ? [note, ...ranked.filter((s) => s !== note)] : ranked;
  const others: ScoredChunk[] = [];
  for (const s of queue) {
    if (others.length >= room) break;
    if (s === overview) continue;
    if (overview && nearDuplicate(s.chunk, overview.chunk)) continue;
    if (others.some((t) => nearDuplicate(s.chunk, t.chunk))) continue;
    others.push(s);
  }
  const top =
    overview && ranked.length > 0
      ? [overview, ...others].sort((a, b) => b.score - a.score)
      : ranked.slice(0, k);

  return { understood: own.length > 0 || soft.length > 0, tokens, expanded, corrected, scored, top };
}
