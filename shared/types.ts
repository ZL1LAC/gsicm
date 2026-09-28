import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const finite = z.number().finite();
export const sourceSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  satellite: z.string().min(1).max(100),
  region: z.string().max(100),
  enabled: z.boolean(),
  product: z
    .enum(["raster", "goes-abi", "gk2a-ami", "himawari-ahi", "elektro-l"])
    .default("raster"),
  transport: z.enum(["http", "ftp", "ftps", "s3"]),
  username: z.string().max(200).default(""),
  password: z.string().max(200).default(""),
  location: z.string().max(2048),
  bucket: z.string().max(100).default(""),
  prefix: z.string().max(1000).default(""),
  awsRegion: z.string().default("us-east-1"),
  pattern: z.string().max(300).default(".*"),
  timestampRegex: z.string().max(300).default("(\\d{8}T\\d{6}Z)"),
  timestampFormat: z
    .enum(["compact", "iso", "julian", "minute", "elektro"])
    .default("compact"),
  cadenceMinutes: z.number().int().min(1).max(180).default(10),
  longitude: finite.min(-180).max(180),
  longitudeAdjustment: finite.min(-10).max(10).default(0),
  crop: z
    .tuple([
      finite.min(0).max(0.49),
      finite.min(0).max(0.49),
      finite.min(0).max(0.49),
      finite.min(0).max(0.49),
    ])
    .default([0, 0, 0, 0]),
  invert: z.boolean().default(false),
  brightness: finite.min(0.1).max(3).default(1),
  expectedWidth: z.number().int().min(64).max(30000).default(5424),
  expectedHeight: z.number().int().min(64).max(30000).default(5424),
  attribution: z.string().max(500),
  cleanConfirmed: z.boolean().default(false),
  blocker: z.string().max(1000).default(""),
});
export type Source = z.infer<typeof sourceSchema>;
export interface SourceValidation {
  at: string;
  compatible: boolean;
  message: string;
  imageId?: string;
}
export type SourceRecord = Source & { validation?: SourceValidation };
export const profileSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  enabled: z.boolean(),
  sourceIds: z.array(id).max(20),
  projection: z.enum(["map", "globe"]),
  longitude: finite.min(-180).max(180).default(180),
  resolution: z
    .union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4)])
    .default(4),
  format: z.enum(["jpg", "png"]).default("jpg"),
  toleranceMinutes: z.number().int().min(1).max(180).default(30),
  underlay: z.string().min(1).max(200),
  brightness: finite.min(0.1).max(3).default(1),
  saturation: finite.min(0).max(2).default(0.7),
  tint: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/)
    .default("1b3f66"),
  haze: finite.min(0).max(1).default(0.6),
});
export type Profile = z.infer<typeof profileSchema>;
export const settingsSchema = z.object({
  pollMinutes: z.number().int().min(1).max(180).default(10),
  cacheHours: z.number().min(1).max(48).default(2),
  logDays: z.number().int().min(1).max(90).default(7),
  processTimeoutMinutes: z.number().int().min(1).max(120).default(15),
  downloadTimeoutSeconds: z.number().int().min(2).max(300).default(60),
  maxDownloadMb: z.number().int().min(1).max(500).default(100),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface Candidate {
  key: string;
  observationTime: string;
  url: string;
}
export interface AcquiredImage {
  id: string;
  sourceId: string;
  observationTime: string;
  acquiredAt: string;
  path: string;
  width: number;
  height: number;
  hash: string;
  remoteKey: string;
  nominalTime?: string;
  geometry?: { longitude: number; height: number };
}
export interface Job {
  id: string;
  profileId: string;
  profileName: string;
  targetTime: string;
  startedAt: string;
  finishedAt?: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  message: string;
  logs: string;
}
export interface PublishedOutput {
  profileId: string;
  jobId: string;
  path: string;
  publishedAt: string;
  targetTime: string;
  observations: {
    sourceId: string;
    satellite: string;
    time: string;
    attribution: string;
  }[];
  width: number;
  height: number;
}
