"use client";

export function SkeletonShiftCard() {
  return (
    <div
      style={{
        width: "100%",
        background: "#111827",
        border: "1px solid #1e293b",
        borderLeft: "3px solid #1e293b",
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Avatar */}
      <div
        className="skeleton"
        style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0 }}
      />

      {/* Name + shift type */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="skeleton" style={{ height: 13, width: "55%", borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 10, width: "28%", borderRadius: 4, marginTop: 7 }} />
      </div>

      {/* Time range */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div className="skeleton" style={{ height: 10, width: 80, borderRadius: 4 }} />
      </div>
    </div>
  );
}

export function SkeletonTeamSection({ count = 4 }: { count?: number }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {/* Label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 18, width: 28, borderRadius: 20 }} />
      </div>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonShiftCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonTimeline() {
  return (
    <div
      style={{
        background: "#1a2236",
        borderRadius: 16,
        padding: "16px 10px 10px",
        marginBottom: 16,
      }}
    >
      {/* Title */}
      <div
        className="skeleton"
        style={{ height: 11, width: 160, borderRadius: 4, marginBottom: 16, marginLeft: 6 }}
      />

      {/* Chart body */}
      <div style={{ padding: "0 0 10px", height: 150, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 4 }}>
        {/* Fake area chart silhouette using stacked bars of varying height */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: "100%", padding: "28px 8px 20px" }}>
          {[40, 55, 65, 70, 75, 80, 75, 72, 68, 70, 72, 75, 78, 80, 76, 70, 65, 60, 55, 50, 45, 42, 38, 35, 30, 28, 25, 22, 20, 18, 16, 14].map(
            (h, i) => (
              <div
                key={i}
                className="skeleton"
                style={{
                  flex: 1,
                  height: `${h}%`,
                  borderRadius: "3px 3px 0 0",
                }}
              />
            )
          )}
        </div>
        {/* X axis tick placeholders */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingInline: 8 }}>
          {[80, 60, 60, 60, 56].map((w, i) => (
            <div key={i} className="skeleton" style={{ height: 9, width: w, borderRadius: 4 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
