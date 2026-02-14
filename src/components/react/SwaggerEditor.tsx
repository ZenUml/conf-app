import React from "react";
import Header from "@/components/react/Header";

interface Props {
  saveAndExit: VoidFunction;
  exit: VoidFunction;
}
const Component = ({ saveAndExit, exit }: Props) => {
  return (
    <div style={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }}>
        <Header saveAndExit={saveAndExit} exit={exit} />
      </div>
      <div id="swagger-editor" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}></div>
      <div id="syntax-error-box" style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: 'white',
        flexShrink: 0
      }}></div>
    </div>
  );
};

export default Component;
