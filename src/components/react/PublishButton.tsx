import * as React from "react";

interface Props {
  saveAndExit: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function PublishButton(props: Props) {
  return (
    <div className=" inline-block ml-2">
      <button
        className="flex items-center gap-1.5 bg-blue-700 px-2 py-1 text-white text-sm font-semibold rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
        onClick={props.saveAndExit}
        disabled={props.disabled || props.loading}
        aria-busy={props.loading ? "true" : "false"}
      >
        {props.loading && (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        <span>{props.loading ? "Publishing…" : "Publish"}</span>
      </button>
    </div>
  );
}
