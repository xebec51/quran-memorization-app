import { createServerClient } from "@quranjs/api/server";

export function createQuranFoundationServerClient() {
  const qfEnv = process.env.QF_ENV === "production" ? "production" : "prelive";

  return createServerClient({
    clientId: process.env.QF_CLIENT_ID ?? "",
    clientSecret: process.env.QF_CLIENT_SECRET ?? "",
    services:
      qfEnv === "production"
        ? {
            tokenHost: "https://oauth2.quran.foundation",
            oauth2BaseUrl: "https://oauth2.quran.foundation",
            contentBaseUrl: "https://apis.quran.foundation/content",
            searchBaseUrl: "https://apis.quran.foundation/search"
          }
        : {
            tokenHost: "https://prelive-oauth2.quran.foundation",
            oauth2BaseUrl: "https://prelive-oauth2.quran.foundation",
            contentBaseUrl: "https://apis-prelive.quran.foundation/content",
            searchBaseUrl: "https://apis-prelive.quran.foundation/search"
          }
  });
}
