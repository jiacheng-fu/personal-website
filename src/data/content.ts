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
 * Only real repos. Team builds are called team builds (Wild West was a
 * HowdyHack team project; Brian asked for it not to be narrowed to one role).
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
 * Only real material: Axle is a capture of its current frontend, Wild West is
 * the game's own background art from its repo. Horizon and CarStatus need
 * footage recorded - neither can be captured from here (one is a Unity
 * build, the other a CLI against a live car - CarStatus has since been
 * recorded against a Smartcar Simulator car instead).
 *
 * DeskStats is the real app's own code (unmodified sources, driven by real
 * click events) recorded on this machine with live readings; only the pointer
 * is drawn in, to show where each click lands. "Personal Website" is a
 * headless capture of the dev build. */
/** `clip` is an mp4 and wins when present. `still` is the picture shown
 *  instead of it (Reduce Motion, no video) - free to be the most telling
 *  frame. `poster` is what the <video> shows until its first frame decodes,
 *  so it must BE that first frame, or the preview flashes one picture and
 *  then cuts to another (Brian, 2026-11-26, Wild West: "a millisecond of the
 *  default screen before the main menu"); cut from the reel's frame 0 with
 *  ffmpeg, falls back to still. None is required - a project with no reel
 *  keeps the numeral instead. */
export type Reel = { clip?: string; still?: string; poster?: string };
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
    reel: { clip: "/reels/axle.mp4", still: "/shots/axle.jpg", poster: "/shots/axle-f0.jpg" },
    years: "2026 — now",
    repo: "https://github.com/jiacheng-fu/axle",
    blurb:
      "AI-powered used-car search — describe what you want in plain English and it finds, ranks, and compares real listings from nearby dealers. Deployed on AWS.",
    stack: ["Python", "FastAPI", "AWS Lambda", "React"],
  },
  {
    title: "Project Horizon",
    reel: { clip: "/reels/horizon.mp4", still: "/shots/horizon.jpg", poster: "/shots/horizon-f0.jpg" },
    years: "2023 — now",
    repo: "https://github.com/jiacheng-fu/project-horizon",
    blurb:
      "A narrative exploration game, solo. Branching dialogue with voiceover sync, third-person traversal, and a life system.",
    stack: ["C#", "Unity"],
  },
  {
    title: "Wild West Party Game",
    reel: { clip: "/reels/wild-west.mp4", still: "/shots/wild-west-menu.jpg", poster: "/shots/wild-west-menu.jpg" },
    years: "2024",
    repo: "https://github.com/jiacheng-fu/wild-west-party-game",
    blurb:
      "A live-multiplayer western party game, built as a team in 24 hours at HowdyHack 2024. Players join a lobby from their phones for drawing and prompt rounds, with AI-generated art.",
    stack: ["Next.js", "TypeScript", "Socket.IO", "Python", "OpenAI"],
  },
  {
    title: "DeskStats",
    reel: { clip: "/reels/deskstats.mp4", still: "/shots/deskstats.jpg", poster: "/shots/deskstats-f0.jpg" },
    years: "2026",
    repo: "https://github.com/jiacheng-fu/DeskStats",
    blurb:
      "A native desktop widget for Apple Silicon: per-core CPU, GPU, memory, power draw and charging rate, read straight from IOKit. No permissions, about 1.4% of one core.",
    stack: ["Swift", "SwiftUI", "AppKit", "IOKit"],
  },
  {
    title: "Personal Website",
    reel: { clip: "/reels/personal-website.mp4", still: "/shots/personal-website.jpg", poster: "/shots/personal-website-f0.jpg" },
    years: "2026 — now",
    repo: "https://github.com/jiacheng-fu/personal-website",
    blurb:
      "The page you're on: a 3D keyboard of my stack (after Naresh Khatri's), and a retro terminal that answers questions about me by quoting its archive word for word, with an optional LLM running on your GPU. No server, no API key.",
    stack: ["React", "TypeScript", "Three.js", "WebGPU"],
  },
  {
    title: "CarStatus",
    /* Real data, simulated car: `npm start` in a real terminal (a clean zsh
       in the project, via ttyd) reading a Smartcar Simulator vehicle through
       the live v3 API - once, then again after the car is driven. */
    reel: { clip: "/reels/carstatus.mp4", still: "/shots/carstatus.jpg", poster: "/shots/carstatus-f0.jpg" },
    years: "2026",
    repo: "https://github.com/jiacheng-fu/CarStatus",
    blurb:
      "A command-line tool for a car's odometer, fuel and battery, built on Smartcar's v3 API, including the webhook setup their docs leave out.",
    stack: ["JavaScript", "Node.js", "Smartcar API"],
  },
];

/** One artifact, chosen because you can click it and it responds. */
export const flagship = {
  reel: { still: "/shots/axle.jpg" },
  title: "Axle",
  live: "https://d1j3m9qdbgs5ik.cloudfront.net",
  repo: "https://github.com/jiacheng-fu/axle",
  blurb:
    "Describe the car you want in plain English and get back ranked real listings. An LLM pipeline turns free-form text into validated JSON, and a 10-level constraint-relaxation algorithm makes sure you get useful matches instead of an empty page when nothing satisfies every filter. It runs serverless on Lambda with a DynamoDB cache that keeps the whole thing inside a 1,000-call/month API budget.",
  stack: ["React", "FastAPI", "AWS Lambda", "DynamoDB", "PostgreSQL"],
};
