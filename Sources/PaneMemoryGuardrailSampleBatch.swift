#if !DEPPY_LITE
import Foundation

struct PaneMemoryGuardrailSampleBatch: Sendable {
    let samples: [PaneMemorySample]
    let scopedOnlySamplesByKey: [PaneMemoryPaneKey: PaneMemorySample]
    let includesCMUXScope: Bool
}
#endif
