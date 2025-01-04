const mongoose = require('mongoose');

const PayerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
});


const SplitSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
});

const ExpenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' }, 
  payers: { type: [PayerSchema], required: true },
  splits: { type: [SplitSchema], required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  readList: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  createdAt: { type: Date, default: Date.now },
});

ExpenseSchema.pre('save', function (next) {
  const totalPaid = this.payers.reduce((sum, payer) => sum + payer.amount, 0);
  const totalSplit = this.splits.reduce((sum, split) => sum + split.amount, 0);

  if (totalPaid !== totalSplit) {
    return next(new Error('The total split amount must equal the total paid amount.'));
  }

  next();
});

module.exports = mongoose.model('Expense', ExpenseSchema);
