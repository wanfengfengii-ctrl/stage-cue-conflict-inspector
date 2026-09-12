/** 预置示例：便于舞台监督快速理解输入约定，不参与任何检测逻辑。 */
export const SAMPLE_CONFLICT = `[
  { "id": "LX-01", "resource": "灯光-面光L1", "startMs": 0, "endMs": 120000 },
  { "id": "LX-02", "resource": "灯光-面光L1", "startMs": 60000, "endMs": 180000 },
  { "id": "LX-03", "resource": "灯光-面光L1", "startMs": 180000, "endMs": 240000 },
  { "id": "LIFT-01", "resource": "升降台-主台", "startMs": 30000, "endMs": 200000 },
  { "id": "FOG-01", "resource": "雾机-上场门", "startMs": 90000, "endMs": 150000 },
  { "id": "FOG-02", "resource": "雾机-上场门", "startMs": 140000, "endMs": 210000 }
]`;

export const SAMPLE_TOUCHING = `[
  { "id": "A", "resource": "灯光-面光L1", "startMs": 0, "endMs": 100000 },
  { "id": "B", "resource": "灯光-面光L1", "startMs": 100000, "endMs": 200000 }
]`;
