module.exports = {
  content: ["./public/**/*.html", "./src/**/*.vue", "./src/**/*.tsx"],
  theme: {
    extend: {}
  },
  plugins: [require("tailwind-scrollbar")({ nocompatible: true })]
};
