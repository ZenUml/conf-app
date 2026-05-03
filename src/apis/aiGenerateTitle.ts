import forgeGlobal from "@/model/globals/forgeGlobal";

export default async function (body: { dsl: string; type?: string }) {
  return fetch(`${forgeGlobal.zenumlRemoteBaseUrl}/ai-generate-title`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
