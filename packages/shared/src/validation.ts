import { z } from 'zod';
import { APP_MODES, DEVICE_ASSIGNMENT_MODES, ICON_KEYS, INFORMATION_IMAGE_VARIANTS, REQUEST_STATUSES } from './domain';

const boundedId = z.string().trim().min(1).max(128);
const boundedCode = z.string().trim().min(1).max(64);
const boundedName = z.string().trim().min(1).max(120);
const boundedDescription = z.string().trim().max(500);
const localizedNameVariants = z.object({
  en: boundedName.optional(),
  es: boundedName.optional()
}).strict();
const localizedDescriptionVariants = z.object({
  en: boundedDescription.optional(),
  es: boundedDescription.optional()
}).strict();

export const idempotencyKeySchema = z.string().min(1).max(128);
export const installationIdSchema = z.string().trim().min(1).max(128);
export const informationImageVariantSchema = z.enum(INFORMATION_IMAGE_VARIANTS);

export const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
}).strict();

export const adminCreateSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(12).max(256),
  active: z.boolean().optional()
}).strict();

export const adminPatchSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  active: z.boolean().optional()
}).strict().refine((value) => value.username !== undefined || value.active !== undefined, {
  message: 'At least one field is required.'
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
}).strict();

export const roomCreateSchema = z.object({
  code: z.string().trim().min(1).max(32),
  displayName: boundedName,
  floor: z.string().trim().max(32).nullable().optional(),
  displayOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
  doNotDisturb: z.boolean().optional()
}).strict();

export const roomPatchSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  displayName: boundedName.optional(),
  floor: z.string().trim().max(32).nullable().optional(),
  displayOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
  doNotDisturb: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedUpdatedAt'), {
  message: 'At least one field is required.'
});

export const roomDoNotDisturbSchema = z.object({ doNotDisturb: z.boolean() }).strict();

export const areaCreateSchema = z.object({
  code: z.string().trim().min(1).max(32),
  displayName: boundedName,
  displayNameVariants: localizedNameVariants.optional(),
  description: boundedDescription.nullable().optional(),
  descriptionVariants: localizedDescriptionVariants.optional(),
  displayOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional()
}).strict();

export const areaPatchSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  displayName: boundedName.optional(),
  displayNameVariants: localizedNameVariants.optional(),
  description: boundedDescription.nullable().optional(),
  descriptionVariants: localizedDescriptionVariants.optional(),
  displayOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedUpdatedAt'), {
  message: 'At least one field is required.'
});

export const serviceCreateSchema = z.object({
  code: boundedCode,
  displayName: boundedName,
  displayNameVariants: localizedNameVariants.optional(),
  description: boundedDescription.nullable().optional(),
  descriptionVariants: localizedDescriptionVariants.optional(),
  iconKey: z.enum(ICON_KEYS).nullable().optional(),
  areaId: boundedId,
  displayOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional()
}).strict();

export const servicePatchSchema = z.object({
  code: boundedCode.optional(),
  displayName: boundedName.optional(),
  displayNameVariants: localizedNameVariants.optional(),
  description: boundedDescription.nullable().optional(),
  descriptionVariants: localizedDescriptionVariants.optional(),
  iconKey: z.enum(ICON_KEYS).nullable().optional(),
  areaId: boundedId.optional(),
  displayOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedUpdatedAt'), {
  message: 'At least one field is required.'
});

export const deviceCreateSchema = z.object({
  installationId: installationIdSchema,
  displayName: boundedName,
  assignmentMode: z.enum(DEVICE_ASSIGNMENT_MODES),
  roomId: boundedId.nullable().optional(),
  areaId: boundedId.nullable().optional(),
  active: z.boolean().optional()
}).strict().superRefine((value, context) => {
  const hasRoom = value.roomId !== undefined && value.roomId !== null;
  const hasArea = value.areaId !== undefined && value.areaId !== null;
  const expectedMode = value.assignmentMode === 'ROOM' ? hasRoom && !hasArea : hasArea && !hasRoom;
  if (!expectedMode) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide exactly one assignment matching assignmentMode.' });
  }
});

export const devicePatchSchema = z.object({
  displayName: boundedName.optional(),
  active: z.boolean().optional(),
  expectedDeviceConfigVersion: z.number().int().positive().optional()
}).strict().refine((value) => value.displayName !== undefined || value.active !== undefined, {
  message: 'At least one field is required.'
});

export const deviceRebindSchema = z.object({
  deviceId: boundedId,
  reason: z.string().trim().min(1).max(500)
}).strict();

export const deviceAssignmentSchema = z.object({
  assignmentMode: z.enum(DEVICE_ASSIGNMENT_MODES),
  roomId: boundedId.nullable().optional(),
  areaId: boundedId.nullable().optional(),
  expectedDeviceConfigVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500)
}).strict();

export const tokenRotationSchema = z.object({
  gracePeriodMinutes: z.number().int().min(5).max(1440).optional(),
  reason: z.string().trim().min(1).max(500)
}).strict();

export const rotationClaimSchema = z.object({ rotationId: boundedId }).strict();

export const requestCreateSchema = z.object({ serviceId: boundedId }).strict();
export const requestTransitionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

export const heartbeatSchema = z.object({
  clientVersion: z.string().trim().max(64).optional(),
  socketConnected: z.boolean().optional(),
  screenVisible: z.boolean().optional()
}).strict();

export const settingsPatchSchema = z.object({
  changes: z.record(z.string().max(64), z.unknown())
}).strict();

export const informationImageReorderSchema = z.object({
  ids: z.array(boundedId).max(1000)
}).strict();

export const modeSchema = z.enum(APP_MODES);
export const requestStatusSchema = z.enum(REQUEST_STATUSES);

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminCreateInput = z.infer<typeof adminCreateSchema>;
export type AdminPatchInput = z.infer<typeof adminPatchSchema>;
export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomPatchInput = z.infer<typeof roomPatchSchema>;
export type RoomDoNotDisturbInput = z.infer<typeof roomDoNotDisturbSchema>;
export type AreaCreateInput = z.infer<typeof areaCreateSchema>;
export type AreaPatchInput = z.infer<typeof areaPatchSchema>;
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
export type ServicePatchInput = z.infer<typeof servicePatchSchema>;
export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DevicePatchInput = z.infer<typeof devicePatchSchema>;
export type DeviceRebindInput = z.infer<typeof deviceRebindSchema>;
export type DeviceAssignmentInput = z.infer<typeof deviceAssignmentSchema>;
export type RequestCreateInput = z.infer<typeof requestCreateSchema>;
export type RequestTransitionInput = z.infer<typeof requestTransitionSchema>;
