import { spawn } from "node:child_process";

const commands = [
  {
    name: "ai",
    command: process.execPath,
    args: ["server/ai-review-server.mjs"]
  },
  {
    name: "web",
    command: process.execPath,
    args: ["./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173"]
  }
];

const children = commands.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      stopAll();
    }
  });
  return child;
});

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  stopAll();
  setTimeout(() => process.exit(0), 300);
});
process.on("SIGTERM", () => {
  stopAll();
  setTimeout(() => process.exit(0), 300);
});
