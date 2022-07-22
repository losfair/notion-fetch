use std::collections::HashMap;

use html2md::{Handle, StructuredPrinter, TagHandler, TagHandlerFactory};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn run_html2md(html: &str) -> String {
    let mut handlers: HashMap<String, Box<dyn TagHandlerFactory>> = HashMap::new();

    // Style tags are incorrectly parsed as text by default.
    handlers.insert("style".into(), Box::new(DummyTagHandlerFactory));

    html2md::parse_html_custom(html, &handlers)
}

struct DummyTagHandlerFactory;

impl TagHandlerFactory for DummyTagHandlerFactory {
    fn instantiate(&self) -> Box<dyn TagHandler> {
        Box::new(DummyTagHandler)
    }
}

struct DummyTagHandler;

impl TagHandler for DummyTagHandler {
    fn handle(&mut self, tag: &Handle, _printer: &mut StructuredPrinter) {
        tag.children.borrow_mut().clear();
    }

    fn after_handle(&mut self, _printer: &mut StructuredPrinter) {}
}
