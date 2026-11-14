import ApWrapper2 from "@/model/ApWrapper2";

const global = {
  apWrapper: new ApWrapper2(),
};

// @ts-ignore
window.globals = global;
export default global;
