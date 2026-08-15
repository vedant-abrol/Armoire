import { createClient } from "@base44/sdk";

const APP_ID = "6a8091c4deffec5cd4db6c05";
const localServer = "http://localhost:4400";

export const base44 = createClient({
  appId: APP_ID,
  ...(import.meta.env.DEV ? { serverUrl: localServer, appBaseUrl: localServer } : {}),
});
