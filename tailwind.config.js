module.exports = {
  content: ["./public/**/*.html", "./src/**/*.vue", "./src/**/*.tsx"],
  theme: {
    extend: {
      colors: {
        primary: "#0052CC",
      },
      // Two motion speeds and two curves cover every UI transition: `fast` for
      // press/hover feedback, `base` for things that move or resize.
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
      },
      transitionTimingFunction: {
        // Decelerates hard — for content that opens, settles or fades out.
        out: "cubic-bezier(.165,.84,.44,1)",
        // Quick start, no overshoot — for press feedback.
        snap: "cubic-bezier(.32,.72,0,1)",
      },
    },
  },
  plugins: [require("tailwind-scrollbar")({ nocompatible: true })],
};
