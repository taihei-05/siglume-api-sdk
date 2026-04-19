import { runCli } from "../cli/index";

void (async () => {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
})();
