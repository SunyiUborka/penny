<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  convertExpenseAmounts,
  formatMoney,
  getCurrencyExponent,
  MAX_EXPENSE_MAJOR_AMOUNT,
  SETTLEMENT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '@filler/shared';
import { fetchRateWithCache } from '../offline/rates.js';
import { toDateInputValue } from '../utils/format.js';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
  expense: { type: Object, required: false, default: null },
  saving: { type: Boolean, required: false, default: false },
  errorMessage: { type: String, required: false, default: '' },
});

const emit = defineEmits(['submit', 'cancel']);

const isEditMode = computed(() => props.expense !== null);
const modalRef = ref(null);

function todayLocalDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const date = ref(todayLocalDateString());
const description = ref('');
const payerId = ref('');
const amountMajor = ref(null);
const currency = ref(props.event.defaultCurrency);
const exchangeRate = ref('1');
const rateSource = ref('manual');
const rateFetchedAt = ref(null);
const sharedWithIds = ref([...props.event.participantIds]);

const itemized = ref(false);
/**
 * Tételsorok az űrlap alakjában: az összeg itt MAJOR egységben van (mint a
 * kiadás `amountMajor`-ja), a `key` pedig csak a Vue listakulcsa — a
 * payloadba nem kerül bele.
 * @type {import('vue').Ref<Array<{ key: number, description: string, amountMajor: number | null, sharedWithIds: string[] }>>}
 */
const items = ref([]);
let nextItemKey = 0;

function createItem(overrides = {}) {
  nextItemKey += 1;
  return {
    key: nextItemKey,
    description: '',
    amountMajor: null,
    sharedWithIds: [...sharedWithIds.value],
    ...overrides,
  };
}

const rateLoading = ref(false);
const rateError = ref('');
const rateEstimated = ref(false);
/**
 * Igaz, ha a beküldött árfolyamot **ez az űrlap oldotta fel** a szerverről
 * (jelenkori árfolyam) — hamis, ha a szerkesztett kiadás SAJÁT, korabeli
 * árfolyamát örököltük, vagy ha a felhasználó kézzel írta be.
 *
 * Ez a tény kizárólag itt ismerhető meg, a payload adataiból NEM
 * kikövetkeztethető: egy hónapokkal korábbi devizás kiadás öröklött
 * árfolyama pontosan úgy néz ki (`rateSource: 'api'`, régi `rateFetchedAt`),
 * mint egy elavult becslés — mindkettő öreg. Ezért utazik külön, a
 * payloadtól elválasztva a store-ig és onnan az outbox-bejegyzésig: a
 * szinkron-motor ebből (és csakis ebből) tudja, hogy szabad-e feltöltéskor
 * újra feloldani az árfolyamot. Egy leírás-javítás így nem értékeli át a
 * júniusi vacsorát a mai árfolyamon (végső re-review U2).
 *
 * **A szervernek küldött payloadba nem kerülhet bele** — nem a kiadás
 * adata, hanem a kliens tudása az árfolyam eredetéről; ezért is külön
 * argumentumként emittáljuk, nem a payload egyik mezőjeként.
 * @type {import('vue').Ref<boolean>}
 */
const rateResolvedByForm = ref(false);
const fieldErrors = ref({});

let initialSnapshot = '';

function snapshot() {
  return JSON.stringify({
    date: date.value,
    description: description.value,
    payerId: payerId.value,
    amountMajor: amountMajor.value,
    currency: currency.value,
    exchangeRate: exchangeRate.value,
    sharedWithIds: [...sharedWithIds.value].sort(),
    itemized: itemized.value,
    items: items.value.map((item) => ({
      description: item.description,
      amountMajor: item.amountMajor,
      sharedWithIds: [...item.sharedWithIds].sort(),
    })),
  });
}

function resetFromExpense(expense) {
  if (expense) {
    const exponent = getCurrencyExponent(expense.currency);
    date.value = toDateInputValue(expense.date);
    description.value = expense.description;
    payerId.value = expense.payerId;
    amountMajor.value = expense.amountMinor / 10 ** exponent;
    currency.value = expense.currency;
    exchangeRate.value = expense.exchangeRate;
    rateSource.value = expense.rateSource;
    rateFetchedAt.value = expense.rateFetchedAt;
    // A kiadás SAJÁT, korabeli árfolyamát töltöttük be — nem mi oldottuk fel
    // most. Amíg a felhasználó nem vált pénznemet (és nem ír be kézzel
    // árfolyamot), ez a szám a kiadás történelmi árfolyama, amit meg kell
    // őrizni.
    rateResolvedByForm.value = false;
    sharedWithIds.value = [...expense.sharedWithIds];
    itemized.value = Array.isArray(expense.items) && expense.items.length > 0;
    items.value = (expense.items ?? []).map((item) =>
      createItem({
        description: item.description ?? '',
        amountMajor: item.amountMinor / 10 ** exponent,
        sharedWithIds: [...item.sharedWithIds],
      }),
    );
  } else {
    date.value = todayLocalDateString();
    description.value = '';
    payerId.value = '';
    amountMajor.value = null;
    currency.value = props.event.defaultCurrency;
    exchangeRate.value = '1';
    rateSource.value = 'manual';
    rateFetchedAt.value = null;
    rateResolvedByForm.value = false;
    sharedWithIds.value = [...props.event.participantIds];
    itemized.value = false;
    items.value = [];
  }
  nextTick(() => {
    initialSnapshot = snapshot();
  });
}

resetFromExpense(props.expense);

const isDirty = computed(() => snapshot() !== initialSnapshot);

const currencyExponent = computed(() => getCurrencyExponent(currency.value));
const amountStep = computed(() => (currencyExponent.value === 0 ? '1' : '0.01'));

/**
 * Egy tételsor összege a pénznem legkisebb egységében. Üres/érvénytelen
 * bevitelnél 0 — a validáció ezt hibaként jelzi, de a végösszeg addig is
 * számolható marad.
 * @param {{ amountMajor: number | null }} item
 */
function itemAmountMinor(item) {
  if (item.amountMajor === null || Number.isNaN(item.amountMajor)) {
    return 0;
  }
  return Math.round(item.amountMajor * 10 ** currencyExponent.value);
}

const itemsTotalMinor = computed(() =>
  items.value.reduce((sum, item) => sum + itemAmountMinor(item), 0),
);

/** A mentendő végösszeg: tételes módban a tételek összege. */
const effectiveAmountMinor = computed(() =>
  itemized.value ? itemsTotalMinor.value : amountMinor.value,
);

const itemsTotalLabel = computed(() =>
  formatMoney({ amountMinor: itemsTotalMinor.value, currency: currency.value }),
);

/**
 * Nyitva van-e a tétellista. Bekapcsoláskor (és szerkesztésre nyitott tételes
 * számlánál) nyitva indul — a csukás kézi művelet.
 */
const itemsExpanded = ref(true);

function toggleItemized() {
  if (itemized.value) {
    if (
      items.value.length > 0 &&
      !window.confirm('A tételbontás elveszik, a végösszeg egyetlen összegként marad. Folytatod?')
    ) {
      return;
    }
    amountMajor.value =
      itemsTotalMinor.value > 0 ? itemsTotalMinor.value / 10 ** currencyExponent.value : null;
    items.value = [];
    itemized.value = false;
    return;
  }
  // Bekapcsolásnál a már beírt összeg egyetlen tételbe kerül, a számla
  // minden résztvevőjével — a „közös" tétel. Így semmi nem veszik el.
  items.value = [createItem({ amountMajor: amountMajor.value })];
  itemized.value = true;
  itemsExpanded.value = true;
}

function addItem() {
  items.value.push(createItem());
}

function removeItem(index) {
  items.value.splice(index, 1);
  // Tételes módban mindig legyen legalább egy sor: egy üres lista se a
  // felületen, se a payloadban nem érvényes állapot.
  if (items.value.length === 0) {
    addItem();
  }
}

function toggleItemParticipant(item, personId) {
  const index = item.sharedWithIds.indexOf(personId);
  if (index === -1) {
    item.sharedWithIds.push(personId);
  } else {
    item.sharedWithIds.splice(index, 1);
  }
}

function selectAllForItem(item) {
  item.sharedWithIds = [...sharedWithIds.value];
}

/**
 * A számla azon résztvevői, akik egyetlen tételen sem osztoznak. Nem hiba
 * (szerkesztés közben átmenetileg mindig van ilyen), csak halk jelzés — ők
 * nem tartoznak semmivel.
 */
const participantsWithoutItemLabel = computed(() => {
  if (!itemized.value) {
    return '';
  }
  const covered = new Set(items.value.flatMap((item) => item.sharedWithIds));
  const names = sharedWithIds.value
    .filter((id) => !covered.has(id))
    .map((id) => participantName(id));
  if (names.length === 0) {
    return '';
  }
  return `${names.join(', ')} egyetlen tételen sem osztozik — nem tartozik semmivel.`;
});

watch(amountMajor, (value) => {
  if (value !== null && !Number.isNaN(value) && value > MAX_EXPENSE_MAJOR_AMOUNT) {
    amountMajor.value = MAX_EXPENSE_MAJOR_AMOUNT;
  }
});

const amountMinor = computed(() => {
  if (amountMajor.value === null || Number.isNaN(amountMajor.value)) {
    return null;
  }
  return Math.round(amountMajor.value * 10 ** currencyExponent.value);
});

const isSettlementCurrency = computed(() => currency.value === SETTLEMENT_CURRENCY);

const baseAmountPreview = computed(() => {
  const amount = effectiveAmountMinor.value;
  if (amount === null || amount <= 0) {
    return null;
  }
  try {
    // Ugyanaz a függvény, ami a szerveren is számol — így a mutatott szám
    // pontosan az, ami tárolódni fog (a tételek külön átváltásának összege),
    // nem a végösszeg egyszeri átváltása.
    // A még üres/0-s sorokat ki kell szűrni: a shared séma pozitív
    // tétel-összeget követel, egy `0` eldobná az egész előnézetet. A fenti
    // `amount <= 0` őr miatt itt legalább egy tétel biztosan pozitív, ha
    // `itemized`, tehát a szűrés nem hozhat létre üres tömböt.
    return convertExpenseAmounts({
      amountMinor: amount,
      items: itemized.value
        ? items.value
            .map((item) => ({ amountMinor: itemAmountMinor(item) }))
            .filter((item) => item.amountMinor > 0)
        : undefined,
      currency: currency.value,
      exchangeRate: exchangeRate.value,
    }).baseAmountMinor;
  } catch {
    return null;
  }
});

const baseAmountPreviewLabel = computed(() => {
  if (baseAmountPreview.value === null) {
    return '';
  }
  const majorAmount = baseAmountPreview.value / 10 ** getCurrencyExponent(SETTLEMENT_CURRENCY);
  return `${majorAmount.toLocaleString('hu-HU')} ${SETTLEMENT_CURRENCY}`;
});

async function fetchRate() {
  if (isSettlementCurrency.value) {
    exchangeRate.value = '1';
    rateSource.value = 'manual';
    rateFetchedAt.value = new Date();
    // Forintnál nincs mit feloldani (az „árfolyam" fix 1), tehát a
    // feltöltéskor sem lesz.
    rateResolvedByForm.value = false;
    return;
  }
  rateLoading.value = true;
  rateError.value = '';
  rateEstimated.value = false;
  try {
    const result = await fetchRateWithCache(currency.value, SETTLEMENT_CURRENCY);
    exchangeRate.value = result.rate;
    rateFetchedAt.value = result.fetchedAt;
    rateSource.value = 'api';
    rateEstimated.value = result.estimated;
    // EZ az űrlap oldotta fel az árfolyamot: jelenkori árfolyam, nem a
    // kiadás korabeli értéke. Akkor is igaz, ha a feloldás friss (mai)
    // értéket adott — lásd a `rateResolvedByForm` jegyzetét: a beküldés és a
    // tényleges feltöltés között napok telhetnek el offline.
    rateResolvedByForm.value = true;
  } catch {
    rateError.value = 'Nem sikerült lekérni az árfolyamot. Add meg kézzel.';
    rateSource.value = 'manual';
    // Kézi árfolyamot senki nem írhat felül a feltöltéskor.
    rateResolvedByForm.value = false;
  } finally {
    rateLoading.value = false;
  }
}

watch(currency, () => {
  fetchRate();
});

if (!isEditMode.value) {
  fetchRate();
}

function handleRateInput() {
  rateSource.value = 'manual';
  rateEstimated.value = false;
  // A felhasználó saját száma: sem a mentés, sem a feltöltés nem cserélheti
  // le egy frissen lekértre.
  rateResolvedByForm.value = false;
}

function toggleParticipant(personId) {
  const index = sharedWithIds.value.indexOf(personId);
  if (index === -1) {
    sharedWithIds.value.push(personId);
    return;
  }
  sharedWithIds.value.splice(index, 1);
  // Aki nem szerepel a számlán, nem szerepelhet a tételein sem — enélkül a
  // szerver a részhalmaz-invariánson utasítaná el a mentést, egy olyan
  // chipre hivatkozva, ami a felületen már nem is látszik.
  for (const item of items.value) {
    const itemIndex = item.sharedWithIds.indexOf(personId);
    if (itemIndex !== -1) {
      item.sharedWithIds.splice(itemIndex, 1);
    }
  }
}

function participantName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

function validate() {
  const errors = {};
  if (!description.value.trim()) {
    errors.description = 'A leírás nem lehet üres.';
  }
  if (!payerId.value) {
    errors.payerId = 'Válassz kifizetőt.';
  }
  const maxAmountMinor = MAX_EXPENSE_MAJOR_AMOUNT * 10 ** currencyExponent.value;
  if (itemized.value) {
    const itemErrors = items.value.map((item) => {
      if (itemAmountMinor(item) <= 0) {
        return 'A tétel összege pozitív szám kell legyen.';
      }
      if (item.sharedWithIds.length === 0) {
        return 'Válassz legalább egy osztozót a tételhez.';
      }
      return '';
    });
    if (itemErrors.some(Boolean)) {
      errors.itemRows = itemErrors;
      // Egy csukott tétellistában a hibaüzenet láthatatlan lenne: a
      // felhasználó annyit látna, hogy a mentés nem történt meg, azt nem,
      // hogy miért. Ezért a hibás tételsor kinyitja a listát.
      itemsExpanded.value = true;
    }
    if (itemsTotalMinor.value > maxAmountMinor) {
      errors.amount = `A végösszeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`;
    }
  } else if (amountMinor.value === null || amountMinor.value <= 0) {
    errors.amount = 'Az összeg pozitív szám kell legyen.';
  } else if (amountMinor.value > maxAmountMinor) {
    errors.amount = `Az összeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`;
  }
  if (sharedWithIds.value.length === 0) {
    errors.sharedWithIds = 'Legalább egy osztozó szükséges.';
  }
  fieldErrors.value = errors;
  return Object.keys(errors).length === 0;
}

function handleSubmit() {
  if (!validate()) {
    return;
  }
  emit(
    'submit',
    {
      date: date.value,
      description: description.value.trim(),
      payerId: payerId.value,
      amountMinor: effectiveAmountMinor.value,
      currency: currency.value,
      exchangeRate: exchangeRate.value,
      rateSource: rateSource.value,
      rateFetchedAt: rateSource.value === 'api' ? rateFetchedAt.value : undefined,
      sharedWithIds: sharedWithIds.value,
      // Nem tételes módban a mező ELHAGYVA megy (undefined): a JSON-ból
      // kimarad, és a szerver ebből tudja, hogy nincs tételezés.
      items: itemized.value
        ? items.value.map((item) => ({
            ...(item.description.trim() ? { description: item.description.trim() } : {}),
            amountMinor: itemAmountMinor(item),
            sharedWithIds: [...item.sharedWithIds],
          }))
        : undefined,
    },
    // Kliensoldali kísérő tény, SZÁNDÉKOSAN külön argumentumban: az első
    // argumentum az, ami a szervernek megy, ez pedig soha nem mehet oda.
    // Külön objektumban ez szerkezetileg garantált — egy payload-mezőt
    // előbb-utóbb valaki továbbküldene.
    { rateResolvedByForm: rateResolvedByForm.value },
  );
}

function attemptClose() {
  if (isDirty.value && !window.confirm('El nem mentett módosítások vannak. Biztosan bezárod?')) {
    return;
  }
  emit('cancel');
}

function focusableElements() {
  if (!modalRef.value) {
    return [];
  }
  return Array.from(
    modalRef.value.querySelectorAll(
      'input, select, button, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.disabled);
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    attemptClose();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }
  const elements = focusableElements();
  if (elements.length === 0) {
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  nextTick(() => {
    focusableElements()[0]?.focus();
  });
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="attemptClose">
    <div
      ref="modalRef"
      class="modal receipt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-modal-title"
    >
      <span class="eyebrow">Kiadás</span>
      <h2 id="expense-modal-title">{{ isEditMode ? 'Kiadás szerkesztése' : 'Új kiadás' }}</h2>
      <form @submit.prevent="handleSubmit">
        <div class="modal__row">
          <div class="field">
            <label for="expense-date">Dátum</label>
            <input id="expense-date" v-model="date" type="date" required :disabled="saving" />
          </div>
          <div class="field expense-modal__payer">
            <label for="expense-payer">Kifizette</label>
            <select id="expense-payer" v-model="payerId" required :disabled="saving">
              <option value="" disabled>Válassz…</option>
              <option v-for="id in event.participantIds" :key="id" :value="id">
                {{ participantName(id) }}
              </option>
            </select>
          </div>
        </div>
        <p v-if="fieldErrors.payerId" role="alert" class="field-error">{{ fieldErrors.payerId }}</p>

        <fieldset class="modal__fieldset">
          <legend>{{ itemized ? 'Kik szerepelnek a számlán' : 'Ki osztozik rajta' }}</legend>
          <div class="modal__participants">
            <button
              v-for="id in event.participantIds"
              :key="id"
              type="button"
              class="participant-chip"
              :class="{ 'is-selected': sharedWithIds.includes(id) }"
              :aria-pressed="sharedWithIds.includes(id)"
              :disabled="saving"
              @click="toggleParticipant(id)"
            >
              {{ participantName(id) }}
            </button>
          </div>
          <p v-if="fieldErrors.sharedWithIds" role="alert" class="field-error">
            {{ fieldErrors.sharedWithIds }}
          </p>
        </fieldset>

        <div class="field">
          <label for="expense-description">Leírás</label>
          <input
            id="expense-description"
            v-model="description"
            type="text"
            required
            :disabled="saving"
          />
        </div>
        <p v-if="fieldErrors.description" role="alert" class="field-error">
          {{ fieldErrors.description }}
        </p>

        <div class="expense-modal__itemized">
          <div class="expense-modal__itemized-row">
            <label class="expense-modal__itemized-label">
              <!--
                `@click.prevent`, nem `@change`: a `toggleItemized` a
                kikapcsolást megerősítéshez kötheti, és megszakításnál nem
                változtat állapotot. A böngésző viszont a natív kattintáskor
                MAGA átállítja a DOM-elemet, és Vue nem írja vissza, mert a
                `:checked` kötött értéke ugyanaz maradt — a jelölőnégyzet így
                az elvetett váltás után is átváltva látszott. Prevent-tel a
                DOM-ot kizárólag a `:checked` mozgatja, tehát mindig az
                állapotot mutatja. Billentyűzetről is működik: a szóköz is
                kattintás-eseményt küld.
              -->
              <input
                type="checkbox"
                class="expense-modal__checkbox"
                :checked="itemized"
                :disabled="saving"
                @click.prevent="toggleItemized"
              />
              <!--
                A pipát ez a `<span>` rajzolja, nem az `<input>` egy
                pszeudoeleme: az `<input>` helyettesített elem, és a Firefox
                egyáltalán nem rendereli rajta a `::before`-t — ott a
                jelölőnégyzet bejelölve is üresnek látszott. Az input maga
                látszólag rejtett, de fókuszálható marad (a modál
                fókuszcsapdája és a szóköz így változatlanul működik), a
                megjelenést pedig a szomszédja adja.
              -->
              <span class="expense-modal__checkbox-box" aria-hidden="true"></span>
              Tételes felosztás
            </label>
            <button
              v-if="itemized"
              type="button"
              class="expense-modal__items-toggle"
              :aria-expanded="itemsExpanded"
              @click="itemsExpanded = !itemsExpanded"
            >
              {{ items.length }} tétel
              <span class="expense-modal__items-caret" aria-hidden="true">▾</span>
            </button>
          </div>
          <p class="expense-modal__itemized-hint">
            Egy számla, több tétel — tételenként más osztozókkal.
          </p>
        </div>

        <!--
          `v-if`, nem `v-show`: a csukott tétellistának el kell tűnnie a
          DOM-ból, mert a modál fókuszcsapdája (`focusableElements`) a
          láthatóságot nem vizsgálja, csak a `disabled`-et — egy elrejtett
          `v-show`-os blokk mezőibe így be lehetne tabolni. Ezért a lenyitó
          gombon nincs `aria-controls` sem: csukott állapotban nem lenne mire
          hivatkoznia.
        -->
        <fieldset v-if="itemized && itemsExpanded" class="modal__fieldset">
          <legend>Tételek</legend>
          <div v-for="(item, index) in items" :key="item.key" class="expense-item">
            <div class="expense-item__row">
              <input
                v-model="item.description"
                type="text"
                class="input-line expense-item__description"
                placeholder="Megnevezés (nem kötelező)"
                maxlength="120"
                :aria-label="`${index + 1}. tétel megnevezése`"
                :disabled="saving"
              />
              <input
                v-model.number="item.amountMajor"
                type="number"
                class="input-line money-input expense-item__amount"
                :step="amountStep"
                min="0"
                placeholder="Összeg"
                :aria-label="`${index + 1}. tétel összege`"
                :disabled="saving"
              />
              <button
                type="button"
                class="btn btn--ghost btn--small expense-item__remove"
                :aria-label="`${index + 1}. tétel törlése`"
                :disabled="saving"
                @click="removeItem(index)"
              >
                ×
              </button>
            </div>
            <div class="modal__participants">
              <button
                type="button"
                class="participant-chip expense-item__all"
                :aria-label="`${index + 1}. tétel: mindenki`"
                :disabled="saving"
                @click="selectAllForItem(item)"
              >
                Mind
              </button>
              <button
                v-for="id in sharedWithIds"
                :key="id"
                type="button"
                class="participant-chip"
                :class="{ 'is-selected': item.sharedWithIds.includes(id) }"
                :aria-label="`${index + 1}. tétel: ${participantName(id)}`"
                :aria-pressed="item.sharedWithIds.includes(id)"
                :disabled="saving"
                @click="toggleItemParticipant(item, id)"
              >
                {{ participantName(id) }}
              </button>
            </div>
            <p v-if="fieldErrors.itemRows?.[index]" role="alert" class="field-error">
              {{ fieldErrors.itemRows[index] }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            :disabled="saving"
            @click="addItem"
          >
            + Tétel
          </button>
          <p v-if="participantsWithoutItemLabel" class="expense-modal__no-item-note">
            {{ participantsWithoutItemLabel }}
          </p>
        </fieldset>

        <div class="modal__row">
          <div class="field">
            <template v-if="!itemized">
              <label for="expense-amount">Összeg</label>
              <input
                id="expense-amount"
                v-model.number="amountMajor"
                type="number"
                class="money-input"
                :step="amountStep"
                min="0"
                :max="MAX_EXPENSE_MAJOR_AMOUNT"
                required
                :disabled="saving"
              />
            </template>
            <template v-else>
              <label for="expense-total">Végösszeg</label>
              <output id="expense-total" class="money expense-modal__total">{{
                itemsTotalLabel
              }}</output>
            </template>
          </div>
          <div class="field">
            <label for="expense-currency">Valuta</label>
            <select id="expense-currency" v-model="currency" :disabled="saving">
              <option v-for="code in SUPPORTED_CURRENCIES" :key="code" :value="code">
                {{ code }}
              </option>
            </select>
          </div>
        </div>
        <p v-if="fieldErrors.amount" role="alert" class="field-error">{{ fieldErrors.amount }}</p>

        <template v-if="!isSettlementCurrency">
          <div class="field expense-modal__rate-field">
            <label for="expense-rate"
              >Árfolyam (1 {{ currency }} = ? {{ SETTLEMENT_CURRENCY }})</label
            >
            <div class="expense-modal__rate-row">
              <input
                id="expense-rate"
                v-model="exchangeRate"
                type="text"
                class="money-input"
                :disabled="saving || rateLoading"
                @input="handleRateInput"
              />
              <button
                type="button"
                class="btn btn--ghost btn--small"
                :disabled="saving || rateLoading"
                @click="fetchRate"
              >
                {{ rateLoading ? 'Frissítés…' : 'Frissítés' }}
              </button>
            </div>
            <p v-if="rateEstimated" class="expense-modal__rate-note">
              ≈ Becsült árfolyam a legutóbb letöltött adatból. A végleges érték mentéskor dől el (ha
              a mentés sorbanállítással végződik, akkor a feltöltéskor), friss árfolyammal.
            </p>
          </div>
          <div class="expense-modal__rate-error-slot">
            <p v-if="rateError" role="alert" class="field-error">{{ rateError }}</p>
          </div>
        </template>

        <p v-if="errorMessage" role="alert" class="field-error">{{ errorMessage }}</p>

        <div class="modal-actions">
          <div class="expense-modal__preview-slot">
            <p v-if="baseAmountPreview !== null" class="expense-modal__preview">
              Összeg:
              <span class="money money--credit">{{ baseAmountPreviewLabel }}</span>
            </p>
          </div>
          <div class="expense-modal__action-buttons">
            <button type="button" class="btn btn--ghost" :disabled="saving" @click="attemptClose">
              Mégse
            </button>
            <button type="submit" class="btn btn--primary" :disabled="saving">
              {{ saving ? 'Mentés…' : 'Mentés' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(30, 42, 34, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-4);
  overflow-y: auto;
  z-index: 10;
}

.modal {
  width: min(480px, 100%);
  max-height: 90vh;
  margin-top: var(--space-6);
  overflow-y: auto;
}

.modal__row {
  display: flex;
  gap: var(--space-3);
}

.modal__row .field {
  flex: 1;
}

.modal__fieldset {
  border: none;
  padding: 0;
  margin: var(--space-4) 0;
}

.modal__fieldset legend {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-soft);
  padding: 0;
  margin-bottom: var(--space-2);
}

.expense-modal__rate-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.expense-modal__rate-row input {
  flex: 1;
}

.expense-modal__rate-field {
  margin-bottom: 0;
}

.expense-modal__preview {
  margin: 0;
  min-width: 0;
  width: 100%;
  background: var(--forint-soft);
  border-radius: 3px;
  padding: var(--space-2) var(--space-3);
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expense-modal__rate-error-slot {
  min-height: 1.3rem;
}

.expense-modal__preview-slot {
  display: flex;
  align-items: center;
  min-height: 2.4rem;
  min-width: 0;
  flex: 1;
}

.modal__participants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.participant-chip {
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.4em 0.9em;
  border-radius: 999px;
  border: 1.5px solid var(--rule-strong);
  background: var(--paper-raised);
  color: var(--ink-soft);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

/* Hover csak igazi kurzorral: érintésnél a koppintás után beragadna, és a
   nagyobb specificitása miatt elnyomná a .is-selected zöld kitöltést. */
@media (hover: hover) and (pointer: fine) {
  .participant-chip:hover:not(:disabled) {
    border-color: var(--forint);
    color: var(--forint);
  }
}

.participant-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.participant-chip.is-selected {
  background: var(--forint);
  border-color: var(--forint);
  color: var(--paper-raised);
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.expense-modal__action-buttons {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.4em 0.7em;
}

@media (max-width: 640px) {
  .modal-actions {
    gap: var(--space-2);
  }

  .expense-modal__preview {
    padding: var(--space-1) var(--space-2);
    font-size: 0.82rem;
  }

  .expense-modal__action-buttons .btn {
    font-size: 0.82rem;
    padding: 0.45em 0.8em;
  }
}

.expense-modal__rate-note {
  margin: var(--space-1) 0 0;
  font-size: 0.8rem;
  color: var(--ink-soft);
}

.expense-modal__itemized {
  margin: var(--space-3) 0 var(--space-4);
}

.expense-modal__itemized-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.expense-modal__itemized-label {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
}

/* Az app egyetlen jelölőnégyzete, ezért itt lakik és nem a theme.css-ben.
   A natív megjelenést a nyugta-nyelv váltja: szögletes doboz, bejelölve
   bankjegy-zöld kitöltéssel — a `participant-chip` kiválasztott állapotának
   ugyanazokkal a színeivel.

   Az input látszólag rejtett, de NEM `display: none` és nem `visibility:
   hidden`: fókuszálhatónak kell maradnia, mert a modál fókuszcsapdája
   (`focusableElements`) rá támaszkodik, és a szóközzel váltás is ezen
   keresztül megy. A doboz és a pipa a szomszédos `<span>`-en van, mert az
   `<input>` helyettesített elem: a Firefox nem rendereli rajta a
   pszeudoelemeket. */
.expense-modal__checkbox {
  position: absolute;
  left: 0;
  width: 1.05rem;
  height: 1.05rem;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.expense-modal__checkbox-box {
  flex-shrink: 0;
  width: 1.05rem;
  height: 1.05rem;
  border: 1.5px solid var(--rule-strong);
  border-radius: 2px;
  background: var(--paper-raised);
  display: grid;
  place-content: center;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

/* A pipa rajzolt jel, nem betűkarakter: így a méretét a doboz szabja meg,
   nem a szövegtörzs betűtípusa. */
.expense-modal__checkbox-box::before {
  content: '';
  width: 0.55rem;
  height: 0.3rem;
  border-left: 2px solid var(--paper-raised);
  border-bottom: 2px solid var(--paper-raised);
  transform: rotate(-45deg) translate(0.03rem, -0.06rem);
  opacity: 0;
}

.expense-modal__checkbox:checked + .expense-modal__checkbox-box {
  background: var(--forint);
  border-color: var(--forint);
}

.expense-modal__checkbox:checked + .expense-modal__checkbox-box::before {
  opacity: 1;
}

.expense-modal__checkbox:focus-visible + .expense-modal__checkbox-box {
  outline: 2px solid var(--forint);
  outline-offset: 2px;
}

.expense-modal__checkbox:disabled {
  cursor: not-allowed;
}

.expense-modal__checkbox:disabled + .expense-modal__checkbox-box {
  opacity: 0.5;
}

/* Lenyitó a tétellistához, a kiadáslista `3 tétel` jelölésének párja. */
.expense-modal__items-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  flex-shrink: 0;
  padding: 0.15rem 0.5rem;
  border: 1px dashed var(--rule-strong);
  border-radius: 999px;
  background: none;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  cursor: pointer;
}

.expense-modal__items-toggle[aria-expanded='true'] {
  border-style: solid;
  color: var(--forint);
}

.expense-modal__items-caret {
  transition: transform 0.15s ease;
}

.expense-modal__items-toggle[aria-expanded='true'] .expense-modal__items-caret {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .expense-modal__checkbox-box,
  .expense-modal__items-caret {
    transition: none;
  }
}

.expense-modal__itemized-hint,
.expense-modal__no-item-note {
  margin: var(--space-1) 0 0;
  font-size: 0.8rem;
  color: var(--ink-soft);
}

/* Tételsor: letépett nyugta-csík a nyugta-lapon belül. */
.expense-item {
  padding: var(--space-2) 0;
  border-bottom: 1px dashed var(--rule);
}

.expense-item__row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-2);
}

.expense-item__description {
  flex: 1;
  min-width: 0;
}

.expense-item__amount {
  width: 8rem;
  flex-shrink: 0;
}

.expense-item__remove {
  flex-shrink: 0;
  line-height: 1;
}

.expense-item__all {
  border-style: dashed;
}

.expense-modal__total {
  display: block;
  font-family: var(--font-mono);
  font-weight: 600;
  padding: 0.55em 0;
}

@media (max-width: 640px) {
  .expense-item__amount {
    width: 6rem;
  }
}
</style>
