const mongoose = require('mongoose');

const SettlementDetailSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User to whom the settlement is made
  amount: { type: Number, required: true, min: 0 }, // Amount to be settled
});

const SettlementSchema = new mongoose.Schema({
  settler: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, 
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' }, 
  settlements: { type: [SettlementDetailSchema], required: true }, 
  readList: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  createdAt: { type: Date, default: Date.now }, 
  file: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
});

module.exports = mongoose.model('Settlement', SettlementSchema);
