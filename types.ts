export type Matrix2 = [
  [number, number],
  [number, number]
];

export type Vector2 = [number, number];

export interface Point2 {
  x: number;
  y: number;
}

export interface SceneVectorEntry {
  id: string;
  color: string;
  initialVector: Point2;
  finalVector: Point2 | null;
  interpolatedVector: Point2 | null;
  path: Point2[];
  contacts: {
    wallId: number;
    axis: WallAxis;
    position: number;
    point: Point2;
    normalDirection: 1 | -1;
  }[];
  backend?: 'kan' | 'exp-log';
  sourceVectorId?: number;
  showMarkers?: boolean;
}

export interface VectorObject {
  id: number;
  value: Vector2;
  visible: boolean;
  color: string;
}

export type WallAxis = 'x' | 'y';

export interface Wall {
  id: number;
  axis: WallAxis;
  position: number;
}

export type FadingPathStyle = 'smooth' | 'dots';
