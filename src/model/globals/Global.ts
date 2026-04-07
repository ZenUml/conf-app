import ApWrapper2 from "@/model/ApWrapper2";

const global = {
  apWrapper: new ApWrapper2(),
  isEmbedded: false,
};

// @ts-ignore
window.globals = global;
export default global
