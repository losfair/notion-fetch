import * as libsupport from "../libsupport/pkg";

export function html2md(input: string): string {
    return libsupport.run_html2md(input);
}

(globalThis as any).LIBSUPPORT = libsupport;
