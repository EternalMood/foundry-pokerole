import { getLocalizedEntriesForSelect, getLocalizedTypesForSelect, POKEROLE } from "../helpers/config.mjs";

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */
export class PokeroleItemSheet extends ItemSheet {

  /** @override */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["pokerole", "sheet", "item"],
      width: 520,
      height: 480,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "attributes" }]
    });
  }

  /** @override */
  get template() {
    const path = "systems/pokerole/templates/item";
    return `${path}/item-${this.item.type}-sheet.html`;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    // Retrieve base data structure.
    const context = await super.getData();

    // Use a safe clone of the item data for further operations.
    const itemData = context.item;

    // Retrieve the roll data for TinyMCE editors.
    context.rollData = {};
    let actor = this.object?.parent ?? null;
    if (actor) {
      context.owned = true;
      context.rollData = actor.getRollData();
    }

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = itemData.system;
    context.flags = itemData.flags;

    context.types = getLocalizedTypesForSelect();
    context.categories = getLocalizedEntriesForSelect('moveCategories');

    context.targets = getLocalizedEntriesForSelect('targets');

    context.ranks = {};
    for (let rank of POKEROLE.ranks.slice(1)) {
      context.ranks[rank] = game.i18n.localize(POKEROLE.i18n.ranks[rank]) ?? rank;
    }

    context.descriptionHtml = await TextEditor.enrichHTML(context.system.description, {
      secrets: this.document.isOwner,
      async: true
    });

    context.healTypes = getLocalizedEntriesForSelect('healTypes');
    context.effectTargets = getLocalizedEntriesForSelect('effectTargets');

    context.healEnabled = context.system.heal?.type !== 'none';
    context.isCustomHeal = context.system.heal?.type === 'custom';
    context.isLeechHeal = context.system.heal?.type === 'leech';

    context.operators = {
      "add": "Add",
      "replace": "Replace"
    };

    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Effects
    html.find(".add-rule").click(async ev => {
      let rules = this.object.system.rules;
      rules.push({
        attribute: '',
        operator: 'add',
        value: 0
      });
      await this.object.update({ "system.rules": rules });
    });
    html.find(".delete-rule").click(async ev => {
      let index = ev.target.dataset.index;
      let rules = this.object.system.rules;
      rules.splice(index, 1);
      await this.object.update({ "system.rules": rules });
    });

    html.find(".rule-attribute").change(async ev => {
      let index = ev.target.dataset.index;
      if (!ev.target.value) {
        return;
      }
      this.object.system.rules[index].attribute = ev.target.value;
      await this.object.update({ "system.rules": this.object.system.rules });
    });
    html.find(".rule-operator").change(async ev => {
      let index = ev.target.dataset.index;
      this.object.system.rules[index].operator = ev.target.value;
      await this.object.update({ "system.rules": this.object.system.rules });
    });
    html.find(".rule-value").change(async ev => {
      let index = ev.target.dataset.index;
      this.object.system.rules[index].value = ev.target.value;
      await this.object.update({ "system.rules": this.object.system.rules });
    });
  }
}
