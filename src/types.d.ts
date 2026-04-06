declare module "*.png" {
    const content: any;
    export default content;
}

declare module "*.svg" {
    const content: string;
    export default content;
}

declare module "*.scss" {
    const content: Record<string, string>;
    export default content;
}

declare module "*.css" {
    const content: Record<string, string>;
    export default content;
}

declare module "prettier";

declare module "prettier/parser-babel";

declare module "vm-browserify";

declare module "vega-lite" {
    export function compile(spec: any, options?: any): { spec: any };
}
