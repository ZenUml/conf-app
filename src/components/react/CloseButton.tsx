import * as React from "react";

interface Props {
  exit: () => void;
  disabled?: boolean;
}

export function CloseButton(props: Props) {
  return (
    <div className=" inline-block ml-2">
      <button
        className="flex items-center bg-blue-700 px-2 py-1 text-white text-sm font-semibold rounded disabled:bg-gray-300"
        onClick={props.exit}
        disabled={props.disabled}
      >
        <span>Close</span>
      </button>
    </div>
  );
}
