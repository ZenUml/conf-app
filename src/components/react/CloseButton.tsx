import * as React from "react";

interface Props {
  exit: () => void;
  disabled?: boolean;
  label?: string;
  small?: boolean;
}

export function CloseButton(props: Props) {
  const { label = 'Close', small = false } = props;
  const baseClass = small
    ? 'flex items-center justify-center w-8 h-8 bg-blue-700 text-white text-sm font-semibold rounded-none disabled:bg-gray-300'
    : 'flex items-center bg-blue-700 px-2 py-1 text-white text-sm font-semibold rounded disabled:bg-gray-300';

  const wrapperClass = small ? 'inline-block' : 'inline-block ml-2';

  return (
    <div className={wrapperClass}>
      <button
        aria-label={label}
        className={baseClass}
        onClick={props.exit}
        disabled={props.disabled}
      >
        <span>{label}</span>
      </button>
    </div>
  );
}
