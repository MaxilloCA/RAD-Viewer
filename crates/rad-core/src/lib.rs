//! Immutable source decoding and non-destructive radiograph processing.
pub mod decode;
pub mod processing;
pub use decode::{decode, ImageMetadata, SourceImage};
pub use processing::{process, Recipe, RenderedImage};
