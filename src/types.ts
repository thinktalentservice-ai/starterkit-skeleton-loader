export type BoneVariant = "text" | "circular" | "rounded" | "rectangular";

/** Computed paint of a container, copied so its frame survives hiding its content. */
export type SurfaceStyle = {
  backgroundColor: string;
  backgroundImage: string;
  borderTop: string;
  borderRight: string;
  borderBottom: string;
  borderLeft: string;
  boxShadow: string;
};

export type Bone = {
  /** `bone` paints as a MUI Skeleton; `surface` repaints a container's own frame. */
  kind: "bone" | "surface";
  variant: BoneVariant;
  /** px from the origin element's padding box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Computed border-radius, "" when there is none. */
  radius: string;
  surface?: SurfaceStyle;
};

export type SkeletonSnapshot = {
  bones: Bone[];
  width: number;
  height: number;
};
