export const profile = {
  name: "Brian Fu",
  role: "Software Engineer",
  tagline:
    "CS at Texas A&M, graduating December 2027. I gravitate to problems where correctness is checkable — compilers, backends, and the security boundaries in between.",
  email: "brian.fu123321@gmail.com",
  github: "https://github.com/jiacheng-fu",
  linkedin: "https://linkedin.com/in/jiachengfu",
  location: "Austin, Texas",
};

/**
 * The interactive field. Ordered roughly by how much of it I've actually
 * written rather than alphabetically, so the density reads as a shape.
 * Only things I've shipped with belong here.
 */
export const skills = [
  "TypeScript",
  "Python",
  "C++",
  "React",
  "FastAPI",
  "PostgreSQL",
  "AWS Lambda",
  "DynamoDB",
  "Node",
  "Deno",
  "Java",
  "C#",
  "GLSL",
  "WebGL",
  "Docker",
  "LLVM",
  "SQL",
  "Supabase",
  "REST APIs",
  "CI/CD",
  "Row-Level Security",
  "Unity",
  "Vite",
  "Next.js",
  "Bash",
  "Git",
];

/**
 * Everything else, newest work first.
 *
 * Only real repos, and the ROLE is stated where it was not solo - Wild West
 * was a team hackathon build and Brian wrote the frontend, so it says so.
 * Dates are when the work happened, not when the repo was pushed to GitHub:
 * Project Horizon has been going since 2023 but the repo was created in 2026.
 */
/* What the projector throws on the screen.
 *
 * `clip` is an mp4 and wins when present; `still` is a fallback frame. A
 * project with neither gets a film leader on screen instead - honest about
 * there being no footage yet, and on-theme, rather than a broken black
 * rectangle. Drop an mp4 in public/reels and set `clip` to light it up.
 *
 * Only real material: CarScout is a capture of the live site, Wild West is
 * the game's own background art from its repo. Horizon and CarStatus need
 * footage recorded - neither can be captured from here (one is a Unity
 * build, the other a CLI against a live car).
 *
 * DeskStats is the real app's own code (unmodified sources, driven by real
 * click events) recorded on this machine with live readings; only the pointer
 * is drawn in, to show where each click lands. "Personal Website" is a
 * headless capture of the dev build. */
/** `clip` is an mp4 and wins when present; `still` is the fallback frame, and
 *  also the poster the video shows before its first frame decodes. Neither is
 *  required - a project with no reel keeps the numeral instead. */
export type Reel = { clip?: string; still?: string };
export type Project = {
  title: string;
  reel: Reel;
  years: string;
  repo: string;
  blurb: string;
  stack: string[];
};

export const projects: Project[] = [
  {
    title: "Axle",
    reel: { clip: "/reels/axle.mp4", still: "/shots/axle.jpg" },
    years: "2026 — now",
    repo: "https://github.com/jiacheng-fu/axle",
    blurb:
      "AI-powered used-car search — describe what you want in plain English and it finds, ranks, and compares real listings from nearby dealers. Deployed on AWS.",
    stack: ["Python", "FastAPI", "AWS Lambda", "React"],
  },
  {
    title: "Project Horizon",
    reel: { clip: "/reels/horizon.mp4", still: "/shots/horizon.jpg" },
    years: "2023 — now",
    repo: "https://github.com/jiacheng-fu/project-horizon",
    blurb:
      "A narrative exploration game, solo. Branching dialogue with voiceover sync, third-person traversal, and a life system.",
    stack: ["C#", "Unity"],
  },
  {
    title: "Wild West Party Game",
    reel: { clip: "/reels/wild-west.mp4", still: "/shots/wild-west.jpg" },
    years: "2024",
    repo: "https://github.com/jiacheng-fu/wild-west-party-game",
    blurb:
      "Live multiplayer party game built in 24 hours at HowdyHack. Team project — I built the frontend: inter-scene mechanics, transitions, and UI across distinct client states.",
    stack: ["TypeScript", "React"],
  },
  {
    title: "DeskStats",
    reel: { clip: "/reels/deskstats.mp4", still: "/shots/deskstats.jpg" },
    years: "2026",
    repo: "https://github.com/jiacheng-fu/DeskStats",
    blurb:
      "A native desktop widget for Apple Silicon: per-core CPU, GPU, memory, power draw and charging rate, read straight from IOKit. No permissions, about 1.4% of one core.",
    stack: ["Swift", "SwiftUI", "AppKit", "IOKit"],
  },
  {
    title: "Personal Website",
    reel: { clip: "/reels/personal-website.mp4", still: "/shots/personal-website.jpg" },
    years: "2026 — now",
    repo: "https://github.com/jiacheng-fu/personal-website",
    blurb:
      "The page you're on: a 3D keyboard of my stack (after Naresh Khatri's), and a retro terminal that answers questions about me with an LLM running on your GPU. No server, no API key.",
    stack: ["React", "TypeScript", "Three.js", "WebGPU"],
  },
  {
    title: "CarStatus",
    /* The CLI needs a live car on the Smartcar account, so this reel is the
       real index.js run against a stub SDK: the program, its formatting and
       its "not available" branch are genuine, the vehicle is sample data. */
    reel: { clip: "/reels/carstatus.mp4", still: "/shots/carstatus-term.jpg" },
    years: "2026",
    repo: "https://github.com/jiacheng-fu/CarStatus",
    blurb:
      "A CLI that reads a BMW's live status over the Smartcar API — odometer, fuel and battery, location.",
    stack: ["JavaScript", "Smartcar API"],
  },
];

/** One artifact, chosen because you can click it and it responds. */
export const flagship = {
  reel: { still: "/shots/carscout.jpg" },
  title: "CarScout",
  live: "https://d1j3m9qdbgs5ik.cloudfront.net",
  repo: "https://github.com/jiacheng-fu/CarScout",
  blurb:
    "Describe the car you want in plain English and get back ranked real listings. An LLM pipeline turns free-form text into validated JSON, and a 10-level constraint-relaxation algorithm makes sure you get useful matches instead of an empty page when nothing satisfies every filter. It runs serverless on Lambda with a DynamoDB cache that keeps the whole thing inside a 1,000-call/month API budget.",
  stack: ["React", "FastAPI", "AWS Lambda", "DynamoDB", "PostgreSQL"],
};
