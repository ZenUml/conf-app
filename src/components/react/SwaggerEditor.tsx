import React from "react";
import Header from "@/components/react/Header";

interface Props {
  saveAndExit: VoidFunction;
  exit: VoidFunction;
}
const Component = ({ saveAndExit, exit }: Props) => {
  return (
    <div>
      <Header saveAndExit={saveAndExit} exit={exit} />
      <div id="swagger-editor"></div>
    </div>
  );
};

export default Component;
