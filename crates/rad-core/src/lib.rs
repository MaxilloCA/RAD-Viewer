//! Immutable source decoding and non-destructive radiograph processing.
pub mod decode;
pub mod presets;
pub mod processing;
pub mod review;
pub use decode::{decode, ImageMetadata, SourceImage};
pub use presets::suggested_recipe;
pub use processing::{process, Recipe, RenderedImage};
