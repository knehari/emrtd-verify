import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/common/security/password-hasher";

describe("password-hasher", () => {
  it("vérifie correctement un mot de passe haché", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejette un mot de passe incorrect", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("produit un sel différent à chaque appel (deux hachages du même mot de passe diffèrent)", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
  });

  it("rejette un hachage malformé sans lever d'exception", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });
});
