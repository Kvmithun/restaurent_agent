import mongoose, { Schema, type Model } from 'mongoose';

const point = { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], default: undefined } };
const accountFields = {
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true }, passwordHash: { type: String, required: true },
  address: { type: String, required: true, trim: true }, location: point,
};

function createAccountModel(name: string, extras: Record<string, unknown> = {}): Model<any> {
  const schema = new Schema({ ...accountFields, ...extras }, { timestamps: true, versionKey: false });
  schema.index({ email: 1 }, { unique: true });
  if (name === 'User' || name === 'Restaurant') schema.index({ location: '2dsphere' });
  return (mongoose.models[name] as Model<any> | undefined) ?? mongoose.model(name, schema);
}

export const User = createAccountModel('User');
export const Restaurant = createAccountModel('Restaurant', {
  restaurantName: { type: String, required: true, trim: true }, ownerName: { type: String, required: true, trim: true },
  fssaiNumber: String, fssaiDocument: String, status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'PENDING' },
  isVerified: { type: Boolean, default: false }, reviewReason: String, reviewedAt: Date, location: point,
});
export const DeliveryPartner = createAccountModel('DeliveryPartner', {
  vehicleType: { type: String, required: true }, vehicleNumber: { type: String, required: true }, drivingLicenceDocument: String,
  vehiclePhoto: String, status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'PENDING' },
  isAvailable: { type: Boolean, default: true }, currentLocation: point, reviewReason: String, reviewedAt: Date,
});

const menuItemSchema = new Schema({
  name: { type: String, required: true, trim: true }, description: { type: String, default: '' }, category: { type: String, required: true },
  price: { type: Number, required: true, min: 0 }, availableQuantity: { type: Number, required: true, min: 0, validate: Number.isInteger }, isAvailable: { type: Boolean, default: true },
}, { timestamps: true });
export const MenuItem = mongoose.models.MenuItem ?? mongoose.model('MenuItem', menuItemSchema);
export const Menu = mongoose.models.Menu ?? mongoose.model('Menu', new Schema({ restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true }, items: { type: [menuItemSchema], default: [] }, published: { type: Boolean, default: false } }, { timestamps: true }));

const orderItemSchema = new Schema({ dishId: { type: Schema.Types.ObjectId, required: true }, dishName: { type: String, required: true }, quantity: { type: Number, required: true, min: 1 }, price: { type: Number, required: true, min: 0 } }, { _id: false });
const orderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  sessionId: { type: String, unique: true, sparse: true },
  deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner' }, items: { type: [orderItemSchema], required: true }, total: { type: Number, required: true },
  deliveryAddress: { type: String, required: true }, status: { type: String, enum: ['PENDING_RESTAURANT','RESTAURANT_ACCEPTED','RESTAURANT_REJECTED','PREPARING','READY_FOR_PICKUP','DELIVERY_ASSIGNED','DELIVERY_ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','FAILED','CANCELLED'], default: 'PENDING_RESTAURANT', index: true },
  restaurantStatus: { type: String, default: 'PENDING' }, cookingStatus: { type: String, default: 'PENDING' }, deliveryStatus: { type: String, default: 'UNASSIGNED' },
  estimatedPreparationMinutes: Number, estimatedReadyAt: Date, retry: { user: { type: Number, default: 0 }, cooking: { type: Number, default: 0 }, delivery: { type: Number, default: 0 } },
  inventoryRestored: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false });
orderSchema.index({ userId: 1, createdAt: -1 });
export const Order = mongoose.models.Order ?? mongoose.model('Order', orderSchema);

export const OrderAttempt = mongoose.models.OrderAttempt ?? mongoose.model('OrderAttempt', new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true }, sessionId: String,
  attemptType: { type: String, enum: ['USER', 'COOKING', 'DELIVERY'], required: true }, attemptNumber: { type: Number, required: true },
  status: { type: String, enum: ['FAILED', 'SUCCEEDED'], required: true }, reason: { type: String, required: true },
}, { timestamps: true }));

export const FailedSession = mongoose.models.FailedSession ?? mongoose.model('FailedSession', new Schema({
  sessionId: { type: String, required: true, unique: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant' }, deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner' },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' }, failureStage: { type: String, required: true }, failureReason: { type: String, required: true },
  retryCounts: { user: Number, cooking: Number, delivery: Number },
}, { timestamps: true }));

export const AccountDocument = mongoose.models.AccountDocument ?? mongoose.model('AccountDocument', new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true }, ownerRole: { type: String, enum: ['RESTAURANT', 'DELIVERY_PARTNER'], required: true },
  category: { type: String, enum: ['FSSAI', 'DRIVING_LICENCE', 'VEHICLE_PHOTO', 'MENU'], required: true },
  originalName: { type: String, required: true }, storageName: { type: String, required: true, unique: true }, contentType: { type: String, required: true },
}, { timestamps: true, versionKey: false }));

export const MenuImport = mongoose.models.MenuImport ?? mongoose.model('MenuImport', new Schema({
  restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: 'AccountDocument', required: true },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' },
  items: { type: [menuItemSchema], default: [] },
}, { timestamps: true, versionKey: false }));
