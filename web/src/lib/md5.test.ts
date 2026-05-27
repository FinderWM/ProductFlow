import { describe, expect, it } from "vitest";

import { md5Hex } from "./md5";

describe("md5Hex", () => {
  it("matches known lowercase MD5 test vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("password")).toBe("5f4dcc3b5aa765d61d8327deb882cf99");
    expect(md5Hex("ProductFlow")).toBe("d448ab14d38b3cc99d419e92eb31320c");
  });

  it("hashes unicode strings as UTF-8", () => {
    expect(md5Hex("灵感")).toBe("1b467083c31ee80696dd477f7bd7530c");
  });
});
