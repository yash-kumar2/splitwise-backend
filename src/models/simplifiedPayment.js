const mongoose = require('mongoose');
//import mongoose from 'mongoose'

const SimplifiedPaymentSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  payments: [{
    payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    payee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 }
  }],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('SimplifiedPayment', SimplifiedPaymentSchema);