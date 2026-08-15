import { createClient } from "@base44/sdk";

const APP_ID = "6a8091c4deffec5cd4db6c05";
const DEMO_EMAIL = "vedant1311nov@gmail.com";
const password = process.env.ARMOIRE_DEMO_PASSWORD?.trim();
const seedOnly = process.argv.includes("--seed-only");
const includeRealData = process.argv.includes("--include-real-data");

if (!password) {
  console.error("Set ARMOIRE_DEMO_PASSWORD in your shell before running this command. The password is never written to disk or printed.");
  process.exit(1);
}

if (seedOnly && includeRealData) {
  console.error("--seed-only and --include-real-data cannot be used together.");
  process.exit(1);
}

const base44 = createClient({ appId: APP_ID });
try {
  await base44.auth.loginViaEmailPassword(DEMO_EMAIL, password);
  const response = seedOnly
    ? await base44.functions.invoke("seed-demo-wardrobe", {})
    : await base44.functions.invoke("reset-demo-wardrobe", {
      confirmation: "RESET_ARMOIRE_DEMO_FIXTURES",
      includeRealData,
    });
  console.log(JSON.stringify(response.data, null, 2));
} catch (error) {
  console.error(error?.response?.data?.error || error?.message || "The demo account command failed.");
  process.exitCode = 1;
} finally {
  base44.cleanup();
}
