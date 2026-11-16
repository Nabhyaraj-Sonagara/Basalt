declare module "*.js";
declare module "*.svg?url" {
  const url: string;
  export default url;
}
