<!--
  The machine's archive: everything the RAG section knows about Brian.

  Written for the questions visitors actually ask, not copied from the
  resume. The machine QUOTES these sentences word for word as its answers,
  so every sentence has to stand on its own: it names its subject ("Brian",
  "At Mesa"), it carries one fact or one tight cluster of facts, and it reads
  as a sentence a person would say.

  Rules:
  - Nothing untrue. Every fact comes from the two resumes in resume/ (August
    and November 2026) or the projects page (src/data/content.ts).
    `node scripts/gen-corpus.cjs` refuses any number it cannot find there.
  - No phone number, ever. The generator redacts one if it creeps in.
  - One "## Section | Title | Dates" heading per card. Section is one of
    About, Overview, Education, Experience, Projects, Skills. The title is
    what the card shows; keep it short.

  After editing: node scripts/gen-corpus.cjs && npm run rag:eval
-->

## About | About Brian

Brian Fu is a software engineer and a Computer Science student at Texas A&M University, graduating in December 2027. Brian's legal first name is Jiacheng, but he goes by Brian. Brian is based in Austin, Texas. Brian is a permanent U.S. resident, so he is authorized to work in the United States and does not need visa sponsorship. Brian gravitates to problems where correctness is checkable: compilers, backends, and the security boundaries in between. Brian currently has a part-time job at ThingsX as an application security and full-stack engineer. You can contact Brian by email at brian.fu123321@gmail.com. Brian is on LinkedIn at linkedin.com/in/jiachengfu. Brian's GitHub is github.com/jiacheng-fu. Brian does not share a phone number on this site.

## Overview | Career at a glance

Brian has worked at three companies: ThingsX, Mesa, and United Micro Technology. Brian's current job is at ThingsX, where he has been an Application Security Engineer and Full-Stack Engineer on a part-time contract since June 2026. From August 2026 to October 2026, Brian was also the Founding Engineer (Backend & ML) at Mesa. Brian has done two internships, both at United Micro Technology: Software Engineering Intern from June 2024 to August 2024, and LLVM Compiler Intern from May 2025 to August 2025. Brian's projects are Axle (since January 2026), Project Horizon (since August 2023), Wild West Party Game (a HowdyHack 2024 team build), DeskStats (2026), CarStatus (2026), and this website (2026). Brian built Axle as its sole author and builds Project Horizon solo; Wild West Party Game was a team build. Brian's oldest project still in progress is Project Horizon, which he started in August 2023. Brian studies Computer Science with a Minor in Mathematics at Texas A&M University, with a 3.87/4.00 GPA, and graduates in December 2027.

## Education | Texas A&M University | Expected Dec 2027

Brian studies at Texas A&M University in College Station, Texas, and is expected to graduate in December 2027. Brian's major is Computer Science and his minor is Mathematics: he is earning a Bachelor of Science in Computer Science with a Minor in Mathematics. Brian's GPA at Texas A&M is 3.87/4.00. Brian's relevant coursework includes Data Structures & Algorithms, Design & Analysis of Algorithms, Machine Learning, Computer Systems, Foundations of Software Engineering, Programming Languages, Discrete Structures, Linear Algebra, and Statistics.

## Experience | ThingsX | Jun 2026 - Present

Since June 2026, Brian has been at ThingsX as an Application Security Engineer and Full-Stack Engineer, on a part-time contract. Brian works on ThingsX's production multi-tenant B2B SaaS platform, built with TypeScript, Deno, PostgreSQL, React, and REST APIs. At ThingsX, Brian has authored and resolved roughly 40 tickets (quality-of-life improvements, defects, and security fixes), owning each change from the schema migration through the API layer to the operator-facing UI. Brian's UI work at ThingsX includes sortable data tables, chart rendering and label-overlap fixes, report filter behavior, account status displays, and role and session state. In his security work at ThingsX, Brian has remediated 50+ production vulnerabilities across access-control, injection, and race-condition classes. Brian fixed a cross-tenant authorization gap at ThingsX by moving privileged-function authorization server-side onto session auth; he proved the fix by reproducing the exploit in reverse, and regression-tested it so the entire bug class fails the build. At ThingsX, Brian built a 13-stage, one-command CI/CD pipeline enforced by a pre-push git hook: typecheck, builds, unit tests, negative Row-Level Security probes, and data-integrity invariants. Brian also eliminated a job-queue data-loss bug at ThingsX with exactly-once TOCTOU guards, verified under 20-way parallel load.

## Experience | Mesa | Aug 2026 - Oct 2026

From August 2026 to October 2026, Brian was the Founding Engineer (Backend & ML) at Mesa. As the sole owner of Mesa's backend, Brian built the production document intake pipeline end to end: quarantine, malware scanning, deduplication, parsing, OCR, segmentation, and classification. Brian covered Mesa's pipeline with roughly 1,880 tests, on a multi-tenant Postgres layer that enforces row-level security on every tenant table. Mesa's pipeline sustained about 790 pages per hour per graphics card, on a tiered reading stack Brian built with Paddle OCR and ONNX Runtime, behind a Postgres work queue whose workers scale to zero when idle. Brian's document classifier at Mesa, a production machine learning system, automated 54.2% of known-source document classification at 99.1% precision in 5.5 milliseconds, rising to 88.7% at 98.9% precision with a language-model tier. For that classifier, Brian labeled a 9,100-document corpus and shipped three tiers: template matching, title rules, and a term-frequency logistic regression. Brian's pre-registered audit of ten classifier variants then established that the model's ceiling was label source diversity, not features. Brian designed Mesa's production cloud deployment to run at roughly $1,100 a month against a $2,500 ceiling, across a 20x range of document volume. Brian also shipped Mesa's frontend-backend contract: token-based tenant identity, read models with committed schemas and generated types, and browser-direct uploads with per-file idempotency keys.

## Experience | United Micro · compiler intern | May 2025 - Aug 2025

From May 2025 to August 2025, Brian was an LLVM Compiler Intern at United Micro Technology. At his compiler internship, Brian worked on United Micro Technology's LLVM compiler backend in C++: he implemented instruction selection rules, register allocation paths, and lowering strategies. Brian also assessed vector instruction extensions for NPU-integrated workloads. Brian enabled early-stage architectural modeling at United Micro Technology by translating ISA specifications into processor description files. Brian's technical report on backend design tradeoffs steered United Micro Technology's subsequent vDSP ASIP compiler work.

## Experience | United Micro · software intern | Jun 2024 - Aug 2024

From June 2024 to August 2024, Brian was a Software Engineering Intern at United Micro Technology. Brian built a Python ingestion system that normalized third-party vendor register descriptions into United Micro Technology's internal SystemRDL representation, cutting the effort to onboard externally acquired IP by an estimated 60-70%. Brian extended the open-source SystemRDL toolchain with custom Jinja2-templated exporters that emit synthesizable RTL, C headers, and documentation in the company's internal file structure. Brian's SystemRDL tool was embedded in the production chip design flow, packaged with Poetry for reproducible installs, and used daily by 200+ engineers.

## Projects | Axle | Jan 2026 - Present

Axle is an AI-powered used-car search that Brian has been building since January 2026: describe the car you want in plain English, and it finds, ranks, and compares real listings from nearby dealers. Brian built and deployed Axle as its sole author, taking it from a TAMUhack prototype to a deployed product with a React and Vite frontend, a FastAPI backend, PostgreSQL, and auth. Axle's LLM pipeline (OpenRouter) turns free-form text into validated, structured JSON, with schema sanitization, fuzzy matching, and two-tier model routing with failover. Axle ranks results with a 10-level progressive constraint-relaxation algorithm over a weighted scoring engine, so a search returns useful matches instead of an empty page when nothing satisfies every filter. Axle stays within a 1,000-call/month free API tier through multi-tier caching across memory, disk, and AWS DynamoDB (NoSQL, with TTL expiry). Axle runs serverless on AWS Lambda and API Gateway, with its frontend on CloudFront and S3. Axle is built with React, TypeScript, Python, FastAPI, PostgreSQL, AWS, and REST APIs.

## Projects | Project Horizon | Aug 2023 - Present

Project Horizon is a narrative exploration game that Brian has been building solo in C# and Unity since August 2023. Project Horizon is written in C# on the Unity engine. Brian owns Project Horizon's full development cycle: a branching storyline system with multiple outcomes, core mechanics, state management, player progression, and UX. Project Horizon has branching dialogue with voiceover sync, third-person traversal, and a life system.

## Projects | Wild West Party Game | Sep 2024

Wild West Party Game is a real-time multiplayer western party game that Brian built with a team in 24 hours at HowdyHack 2024, in September 2024. In Wild West Party Game, players join a lobby from their phones for drawing and prompt rounds, with AI-generated art. Brian's work on Wild West Party Game included its inter-scene mechanics, transitions, and UI, for a working multiplayer prototype with real-time connectivity across distinct client states. Wild West Party Game was built with Next.js, TypeScript, React, Socket.IO, Python, and OpenAI.

## Projects | DeskStats | 2026

DeskStats is a native desktop widget for Apple Silicon Macs that Brian built in 2026 with Swift, SwiftUI, AppKit, and IOKit. DeskStats shows per-core CPU, GPU, memory, power draw, and charging rate, read straight from IOKit. DeskStats needs no permissions and uses about 1.4% of one CPU core.

## Projects | CarStatus | 2026

CarStatus is a command-line tool that Brian built in 2026 to read a car's odometer, fuel, and battery through Smartcar's v3 API. CarStatus includes the webhook setup that Smartcar's documentation leaves out. CarStatus is written in JavaScript on Node.js. The CarStatus recording on the projects page runs the tool in a real terminal against a Smartcar Simulator car, through Smartcar's real v3 API.

## Projects | This website | 2026 - Present

Brian built this website in 2026 with React, TypeScript, Vite, and Three.js. The 3D keyboard on this website shows Brian's stack; the keyboard idea and keycaps are from Naresh Khatri's MIT-licensed portfolio. The photo at the top of this website was taken on the Space Needle in Seattle, not in Austin. This website's question machine works by searching this archive about Brian with BM25 scoring inside your browser, and quoting the closest-matching sentences word for word. This website has no server and no API key, and nothing you type into this machine leaves your browser. A note a visitor teaches this machine stays only in that visitor's browser tab and is gone on reload.

## Skills | Languages

Brian codes in C++, Java, Python, TypeScript, JavaScript, C#, SQL (PostgreSQL and PL/pgSQL), Bash, Haskell, HTML, and CSS. Brian has also shipped Swift (DeskStats) and GLSL.

## Skills | Full-Stack & ML

On the web, Brian builds with React, Next.js, Node.js, Deno, Vite, and FastAPI, with SQLAlchemy, Alembic, and Pydantic in Python. Brian designs REST APIs and PostgreSQL schemas and migrations, and implements authentication and authorization, caching, and responsive UIs. For machine learning, Brian has used scikit-learn, OCR with PaddleOCR, ONNX Runtime with CUDA, LLM integration, and evaluation design; at Mesa, Brian put OCR and a document classifier into production. Brian builds games in Unity.

## Skills | Systems, Cloud & Security

For version control and CI, Brian uses Git, GitHub, and GitHub Actions, and he has built CI/CD pipelines. Brian ships with Docker and Docker Compose, tests with pytest, and has built job queues and TOCTOU race-condition tests. For cloud, Brian uses AWS (Lambda, API Gateway, DynamoDB, IAM, S3, and CloudFront), and he has also used Supabase (PostgREST and Auth), MinIO, and Vercel. Brian's systems work includes LLVM compiler backends and SystemRDL/RTL code generation. Brian's security skills include multi-tenant isolation, Row-Level Security, threat modeling, OWASP vulnerability classes, and exploit-regression validation.
