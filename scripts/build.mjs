  import { build } from "esbuild";
  import { cp, mkdir, rm } from "node:fs/promises";

  const outDirectory = "dist";

  await rm(outDirectory, {
    recursive: true,
    force: true,
  });

  await mkdir(outDirectory, {
    recursive: true,
  });

  await build({
    entryPoints: {
      popup: "src/popup.ts",
      background: "src/background.ts",
    },
    outdir: outDirectory,
    bundle: true,
    format: "iife",
    target: "chrome120",
    sourcemap: true,
  });

  await cp("public", outDirectory, {
    recursive: true,
  });

  console.log("확장 프로그램 빌드가 완료되었습니다.");