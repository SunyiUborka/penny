/**
 * Egyszeri migráció: az elszámolás mindig forintban történik, eseményenkénti
 * alapvaluta-választás nélkül (lásd eventModel.js — a `baseCurrency` mező
 * megszűnt). A korábban felvett kiadások `baseAmountMinor`-ja azonban a
 * FELVÉTELKOR érvényes esemény-alapvaluta ellen lett kiszámolva — ha egy
 * esemény alapvalutáját később megváltoztatták, a régi kiadások
 * baseAmountMinor-ja rossz pénznemben "értendő" (pl. forintként tárolt
 * összeg euróként jelenne meg). Ez a script minden kiadásra újraszámolja a
 * baseAmountMinor-t a saját (amountMinor, currency, exchangeRate) hármasa
 * alapján, forintra célozva, és leszedi az események elavult
 * `baseCurrency` mezőjét.
 *
 * Futtatás: node src/scripts/migrate-settlement-currency-to-huf.js
 */
import mongoose from 'mongoose';
import { convertMinorAmount, SETTLEMENT_CURRENCY } from '@filler/shared';
import { ExpenseModel } from '../models/expenseModel.js';
import { EventModel } from '../models/eventModel.js';

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('MONGO_URL nincs beállítva.');
  process.exit(1);
}

await mongoose.connect(mongoUrl);

const expenses = await ExpenseModel.find();
let updatedExpenses = 0;

for (const expense of expenses) {
  const correctBaseAmountMinor =
    expense.currency === SETTLEMENT_CURRENCY
      ? expense.amountMinor
      : convertMinorAmount({
          amountMinor: expense.amountMinor,
          rate: expense.exchangeRate,
          sourceCurrency: expense.currency,
          targetCurrency: SETTLEMENT_CURRENCY,
        });

  if (correctBaseAmountMinor !== expense.baseAmountMinor) {
    console.log(
      `Kiadás ${expense._id} (${expense.description}): baseAmountMinor ${expense.baseAmountMinor} -> ${correctBaseAmountMinor}`,
    );
    expense.baseAmountMinor = correctBaseAmountMinor;
    await expense.save();
    updatedExpenses += 1;
  }
}

// A modell már nem ismeri a `baseCurrency` mezőt, ezért a $unset-hez a nyers
// driver collection-t kell használni — a Mongoose strict:'throw' módban a
// modellen keresztül elutasítaná a séman kívüli mező módosítását.
const eventUnsetResult = await EventModel.collection.updateMany(
  {},
  { $unset: { baseCurrency: '' } },
);

console.log(`Kész. ${updatedExpenses}/${expenses.length} kiadás baseAmountMinor-ja javítva.`);
console.log(`${eventUnsetResult.modifiedCount} esemény elavult baseCurrency mezője eltávolítva.`);

await mongoose.disconnect();
