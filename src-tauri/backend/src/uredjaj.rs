//! TODO: port u toku.

use serde_json::Value;

use crate::greska::R;
use crate::{Args, Backend};

pub fn obradi(_b: &mut Backend, _kanal: &str, _a: &Args) -> Option<R<Value>> {
    None
}
