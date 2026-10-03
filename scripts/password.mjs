import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
let mute = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!mute) process.stderr.write(chunk, encoding);
    done();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: process.stdin.isTTY,
});
process.stderr.write("Admin password (input hidden): ");
mute = true;
rl.question("", (password) => {
  rl.close();
  process.stderr.write("\n");
  if (password.length < 12) {
    process.stderr.write("Use at least 12 characters.\n");
    process.exitCode = 1;
    return;
  }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
  process.stdout.write(
    `pbkdf2-sha256:100000:${salt.toString("hex")}:${hash.toString("hex")}\n`,
  );
});
