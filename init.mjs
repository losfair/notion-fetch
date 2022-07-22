
import wasm from "../libsupport/pkg/libsupport_bg.wasm";

{
    let wasmInit = null;
    globalThis.ensureWasmInit = () => {
        if (!wasmInit) wasmInit = globalThis.LIBSUPPORT.default(wasm);
        return wasmInit;
    }
}
