<script setup>
import { onMounted, ref } from 'vue';
import { usePeopleStore } from '../stores/people.js';

const peopleStore = usePeopleStore();

const newName = ref('');
const createError = ref('');
const creating = ref(false);

const editingId = ref(null);
const editingName = ref('');
const rowError = ref({});

onMounted(() => {
  peopleStore.fetchPeople();
});

async function handleCreate() {
  if (!newName.value.trim()) {
    return;
  }
  creating.value = true;
  createError.value = '';
  try {
    await peopleStore.createPerson(newName.value.trim());
    newName.value = '';
  } catch (error) {
    createError.value = error.message ?? 'Nem sikerült létrehozni a személyt.';
  } finally {
    creating.value = false;
  }
}

function startEdit(person) {
  editingId.value = person.id;
  editingName.value = person.name;
}

function cancelEdit() {
  editingId.value = null;
  editingName.value = '';
}

async function saveEdit(person) {
  try {
    await peopleStore.renamePerson(person.id, editingName.value.trim());
    cancelEdit();
  } catch (error) {
    rowError.value = { ...rowError.value, [person.id]: error.message ?? 'Nem sikerült átnevezni.' };
  }
}

async function handleDelete(person) {
  const confirmed = window.confirm(`Biztosan törlöd "${person.name}"-t a névjegyzékből?`);
  if (!confirmed) {
    return;
  }
  try {
    await peopleStore.deletePerson(person.id);
  } catch (error) {
    rowError.value = { ...rowError.value, [person.id]: error.message ?? 'Nem sikerült törölni.' };
  }
}
</script>

<template>
  <main class="settings">
    <span class="eyebrow">Fillér</span>
    <h1>Beállítások</h1>

    <section class="settings__section">
      <h2>Névjegyzék</h2>
      <p class="settings__hint">
        Ebből választod ki a résztvevőket eseményenként. Az átnevezés visszamenőleg mindenhol
        érvényesül.
      </p>

      <form class="settings__add" @submit.prevent="handleCreate">
        <div class="field settings__add-field">
          <label for="new-person-name">Új személy neve</label>
          <input id="new-person-name" v-model="newName" type="text" :disabled="creating" required />
        </div>
        <button type="submit" class="btn btn--primary" :disabled="creating">Hozzáadás</button>
      </form>
      <p v-if="createError" role="alert" class="field-error">{{ createError }}</p>

      <p v-if="peopleStore.loading" class="settings__hint">Betöltés…</p>
      <p v-else-if="peopleStore.error" role="alert" class="settings__hint">
        Nem sikerült betölteni a névjegyzéket.
      </p>
      <p v-else-if="peopleStore.people.length === 0" class="settings__hint">
        Még nincs senki a névjegyzékben.
      </p>

      <ul v-else class="settings__list">
        <li v-for="person in peopleStore.people" :key="person.id" class="settings__row">
          <template v-if="editingId === person.id">
            <input v-model="editingName" type="text" class="settings__edit-input" />
            <div class="settings__row-actions">
              <button type="button" class="btn btn--primary btn--small" @click="saveEdit(person)">
                Mentés
              </button>
              <button type="button" class="btn btn--ghost btn--small" @click="cancelEdit">
                Mégse
              </button>
            </div>
          </template>
          <template v-else>
            <span class="settings__name">{{ person.name }}</span>
            <div class="settings__row-actions">
              <button type="button" class="btn btn--ghost btn--small" @click="startEdit(person)">
                Átnevezés
              </button>
              <button
                type="button"
                class="btn btn--danger btn--small"
                @click="handleDelete(person)"
              >
                Törlés
              </button>
            </div>
          </template>
          <p v-if="rowError[person.id]" role="alert" class="field-error settings__row-error">
            {{ rowError[person.id] }}
          </p>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.settings {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
}

.settings__section {
  margin-top: var(--space-8);
}

.settings__hint {
  color: var(--ink-soft);
  font-size: 0.92rem;
}

.settings__add {
  display: flex;
  align-items: end;
  gap: var(--space-3);
  margin: var(--space-4) 0;
}

.settings__add-field {
  flex: 1;
  margin-bottom: 0;
}

.settings__list {
  list-style: none;
  padding: 0;
  margin: var(--space-4) 0 0;
  border-top: 2px solid var(--ink);
}

.settings__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--rule);
  flex-wrap: wrap;
}

.settings__name {
  flex: 1;
  font-weight: 600;
}

.settings__edit-input {
  flex: 1;
  font-family: var(--font-body);
  font-size: 1rem;
  padding: 0.4em 0.5em;
  border: none;
  border-bottom: 2px solid var(--forint);
  background: transparent;
}

.settings__row-actions {
  display: flex;
  gap: var(--space-2);
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.4em 0.7em;
}

.settings__row-error {
  width: 100%;
  margin-top: var(--space-1);
}
</style>
