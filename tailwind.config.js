module.exports = {
  content: ["./public/**/*.html", "./src/**/*.vue", "./src/**/*.tsx"],
  theme: {
    extend: {
      colors: {
        primary: "#0052CC",
      },
    },
  },
  plugins: [require("tailwind-scrollbar")({ nocompatible: true })],
};
