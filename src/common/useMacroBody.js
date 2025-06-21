import { useEffect, useState } from "react";
import { view } from "@forge/bridge";
import { convertMacroBody, fetchConvertedMacroBody } from "./fetch";

export const useMacroBody = () => {
  const [htmlBody, setHtmlBody] = useState(null);
  const [macroBody, setMacroBody] = useState(null);

  useEffect(async () => {
    const context = await view.getContext();

    const contentId = context.extension.content.id;
    const macroBody = context.extension.macro?.body;
    setMacroBody(macroBody);

    if (macroBody) {
      const asyncId = await convertMacroBody(
        "styled_view",
        macroBody,
        contentId
      );

      const htmlBody = await fetchConvertedMacroBody(asyncId);
      setHtmlBody(htmlBody);
    }
  }, []);

  return { htmlBody, macroBody };
};
