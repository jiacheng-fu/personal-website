/* One line under each keycap's name.
 *
 * Shown top-right when a cap is hovered or pressed. Not about Brian and not
 * about the resume - a quirky, relatable one-liner about the THING itself,
 * the kind anyone who has touched it will recognise. Every label on the
 * board (Keyboard3D ROWS) has an entry; the build does not check that, so
 * keep them in step when adding keys. */
export const CAP_NOTES: Record<string, string> = {
  // languages
  "C++": "gotta go fast (and segfault faster)",
  "C#": "Java, but Microsoft got there second",
  Java: "write once, debug everywhere",
  Python: "indentation is a feature, not a bug. mostly.",
  TypeScript: "JavaScript that yells at you before your users do",
  JavaScript: "[] + {} is \"[object Object]\". don't ask.",
  Swift: "the language Apple is very sure you should use",
  Haskell: "a monad is just a monoid in the category of endofunctors, obviously",
  Bash: "works perfectly until a path has a space in it",
  SQL: "SELECT * FROM regrets WHERE index IS NULL",
  HTML: "not a programming language, and you'll defend it anyway",

  // browser + runtimes
  CSS: "the box is centered. no wait. now it's centered.",
  React: "it's just a function. that re-renders. sixteen times.",
  "Next.js": "React, but now the server is involved and so is Vercel",
  Vite: "the dev server that's done before you finish blinking",
  Node: "JavaScript escaped the browser and nobody stopped it",
  npm: "node_modules: heavier than a black hole",
  Deno: "Node, if Node's creator got a do-over",
  Vercel: "git push and it's live. somehow.",
  "Three.js": "3D in the browser, held together by matrix math and hope",
  WebGL: "make a laptop fan spin from a web page",
  Unity: "the engine behind half your Steam library",

  // backend + cloud
  FastAPI: "type hints in, API docs out. feels like cheating.",
  Poetry: "Python packaging that finally rhymes",
  PyTorch: "the gradient does the homework for you",
  OpenRouter: "one API key, every model. commitment issues, solved.",
  PostgreSQL: "the elephant that never forgets your data",
  Supabase: "Firebase, but it's Postgres underneath and proud of it",
  DynamoDB: "infinitely scalable, infinitely opinionated about your keys",
  "AWS Lambda": "your code runs somewhere. you're not allowed to know where.",
  "API Gateway": "the bouncer for your Lambdas",
  Docker: "works on my machine — so we shipped my machine",

  // systems + silicon
  VHDL: "programming, except everything happens at once",
  Linux: "runs the whole world and still can't find your printer",
  Vim: "you can exit. you just don't know how yet.",
  Git: "version control for my thingamajigs",
  "GitHub Actions": "the robot that fails your build at 2am",
  Playwright: "a browser that clicks exactly what you say, unlike users",
  LLVM: "the compiler that compiles the compilers",
  SystemRDL: "a spreadsheet of registers, but make it a language",
  SystemVerilog: "Verilog with classes, and more ways to be wrong",

  // the bottom row (these caps open things)
  GitHub: "where code goes to be starred and never read — press to visit",
  Email: "the original async messaging — press to say hi",
  Source: "this site's own code, warts and all — press to peek",
  LinkedIn: "I'm thrilled to announce — press to connect",
};
