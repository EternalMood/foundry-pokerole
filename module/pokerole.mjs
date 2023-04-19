import { PokeroleActor } from "./documents/actor.mjs";
import { PokeroleItem } from "./documents/item.mjs";
import { PokeroleCombat, PokeroleCombatTracker } from "./documents/combat.mjs";
import { PokeroleActorSheet } from "./sheets/actor-sheet.mjs";
import { PokeroleItemSheet } from "./sheets/item-sheet.mjs";
import { preloadHandlebarsTemplates } from "./helpers/templates.mjs";
import { getAilmentList, POKEROLE } from "./helpers/config.mjs";
import { rollRecoil, successRollAttributeDialog, successRollFromExpression } from "./helpers/roll.mjs";
import { showClashDialog } from "./helpers/clash.mjs";
import { bulkApplyDamageValidated, canModifyTokenOrActor } from "./helpers/damage.mjs";
import { registerIntegrationHooks } from "./helpers/integrations.mjs";
import { registerEffectHooks } from "./helpers/effects.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once('init', async () => {
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.pokerole = {
    PokeroleActor,
    PokeroleItem,
    useItemMacro
  };

  // Add custom constants for configuration.
  CONFIG.POKEROLE = POKEROLE;

  CONFIG.Combat.initiative.formula = "1d6 + @attributes.dexterity.value + @skills.alert.value + @customInitiativeMod";

  // Define custom Document classes
  CONFIG.Actor.documentClass = PokeroleActor;
  CONFIG.Item.documentClass = PokeroleItem;
  CONFIG.Combat.documentClass = PokeroleCombat;
  CONFIG.ActiveEffect.documentClass = PokeroleActiveEffect;
  CONFIG.ui.combat = PokeroleCombatTracker;

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("pokerole", PokeroleActorSheet, { makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("pokerole", PokeroleItemSheet, { makeDefault: true });

  CONFIG.TextEditor.enrichers.push({
    pattern: /\[\[(?:\/|#)sc ([^\]]+)\]\](?:{([^}]+)})?/gi,
    enricher: successRollEnricher,
  });

  CONFIG.statusEffects = getAilmentList();
  CONFIG.specialStatusEffects = POKEROLE.specialStatusEffects;

  await preloadHandlebarsTemplates();
  registerSettings();
});

Hooks.once("ready", async function () {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (["Item"/*, "ActiveEffect"*/].includes(data.type)) {
      createItemMacro(data, slot);
      return false;
    }
  });
  $("body").on("click", "a.inline-roll-cmd", onInlineRollClick);
  $("body").on("click", "button.chat-action", onChatActionClick);
});

// Chat message hooks
Hooks.on('renderChatLog', (app, html, data) => PokeroleItem.chatListeners(html));
Hooks.on('renderChatPopout', (app, html, data) => PokeroleItem.chatListeners(html));

PokeroleCombatTracker.registerHooks();
registerIntegrationHooks();
registerEffectHooks();

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

// If you need to add Handlebars helpers, here are a few useful examples:
Handlebars.registerHelper('concat', function () {
  var outStr = '';
  for (var arg in arguments) {
    if (typeof arguments[arg] != 'object') {
      outStr += arguments[arg];
    }
  }
  return outStr;
});

// greater than
Handlebars.registerHelper('gt', function (a, b) {
  var next = arguments[arguments.length - 1];
  return (a > b) ? next.fn(this) : next.inverse(this);
});

// less than
Handlebars.registerHelper('lt', function (a, b) {
  var next = arguments[arguments.length - 1];
  return (a < b) ? next.fn(this) : next.inverse(this);
});

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

/** Register Pokérole game settings */
function registerSettings() {
  game.settings.register('pokerole', 'specialDefenseStat', {
    name: 'POKEROLE.SettingNameSpecialDefenseStat',
    hint: 'POKEROLE.SettingHintSpecialDefenseStat',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'vitality': 'POKEROLE.AttributeVitality',
      'insight': 'POKEROLE.AttributeInsight',
    },
    default: 'vitality',
    requiresReload: true
  });

  game.settings.register('pokerole', 'combatResourceAutomation', {
    name: 'POKEROLE.SettingNameCombatResourceAutomation',
    hint: 'POKEROLE.SettingHintCombatResourceAutomation',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
}

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createItemMacro(dropData, slot) {
  const macroData = { type: "script", scope: "actor" };
  switch (dropData.type) {
    case "Item":
      const itemData = await Item.implementation.fromDropData(dropData);
      if (!itemData) return ui.notifications.warn(game.i18n.localize("You can only create macro buttons for owned Items"));
      foundry.utils.mergeObject(macroData, {
        name: itemData.name,
        img: itemData.img,
        command: `game.pokerole.useItemMacro("${itemData.uuid}")`,
        flags: { "pokerole.itemMacro": true }
      });
      break;
    default:
      return true;
  }

  // Assign the macro to the hotbar
  const macro = game.macros.find(m => (m.name === macroData.name) && (m.command === macroData.command)
    && m.author.isSelf) || await Macro.create(macroData);
  game.user.assignHotbarMacro(macro, slot);
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemUuid
 */
async function useItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: 'Item',
    uuid: itemUuid
  };
  // Load the item from the uuid.
  const item = await Item.implementation.fromDropData(dropData);
  // Determine if the item loaded and if it's an owned item.
  if (item && !item.parent) {
    return ui.notifications.warn(`The item does not have an owner. Only owned items are supported.`);
  } else if (!item || !item.parent) {
    const itemName = item?.name ?? itemUuid;
    return ui.notifications.warn(`Could not find item ${itemName}. You may need to delete and recreate this macro.`);
  }

  // Trigger the item roll
  item.use();
}

/** Called when clicking chat action buttons like "Clash" etc. */
async function onChatActionClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest(".message").dataset.messageId;
  const message = game.messages.get(messageId);

  const token = canvas.tokens.controlled.length > 0 ? canvas.tokens.controlled[0] : null;
  const actor = token?.document?.actor ?? game.user?.character;
  const chatData = { speaker: ChatMessage.implementation.getSpeaker({ token: token?.document, actor }) };

  const action = event.target.dataset.action;
  if (action === 'clash' || action === 'evade') {
    if (!actor) {
      return ui.notifications.error('No actor selected');
    }

    if (!actor.hasAvailableActions()) {
      return ui.notifications.error("You can't take any more actions this round.");
    }
  }

  try {
    switch (action) {
      case 'clash': {
        if (!actor.system.canClash) {
          return ui.notifications.error("You can only clash once per round.");
        }

        const { attackerId, moveId, expectedSuccesses } = event.target.dataset;
        const attacker = await fromUuid(attackerId);
        if (!attacker) {
          return ui.notifications.error("The attacking actor doesn't exist anymore");
        }
        if (attacker.id === actor.id) {
          return ui.notifications.error("You can't clash your own attack!");
        }

        const move = await fromUuid(moveId);
        if (!move) {
          return ui.notifications.error("The move to be clashed doesn't exist anymore");
        }
        const clashMove = await showClashDialog(actor, token, attacker, move, expectedSuccesses ?? 1, chatData);
        if (clashMove && game.settings.get('pokerole', 'combatResourceAutomation')) {
          actor.increaseActionCount({ 'system.canClash': false });
          clashMove.update({ 'system.usedInRound': true });
        }
        break;
      }
      case 'evade': {
        if (!actor.system.canEvade) {
          return ui.notifications.error("You can only evade once per round.");
        }

        const hasEvaded = await successRollAttributeDialog({
          name: 'Evade',
          value: actor.system.derived.evade.value
        }, {
          painPenalty: actor.system.painPenalty,
          confusionPenalty: actor.hasAilment('confused')
        },
        chatData, !event.shiftKey);

        if (hasEvaded && game.settings.get('pokerole', 'combatResourceAutomation')) {
          actor.increaseActionCount({ 'system.canEvade': false });
        }
        break;
      }
      case 'recoil': {
        const { actorId, tokenUuid, damage } = event.target.dataset;
        const token = tokenUuid ? await fromUuid(tokenUuid) : undefined;
        const attacker = token ? token?.actor : await Actor.get(actorId);
        if (!attacker) {
          return ui.notifications.error("The attacking actor doesn't exist anymore");
        }
        if (!(game.user.isGM || message.isAuthor)) {
          return ui.notifications.error("You can't use this item.");
        }
        await rollRecoil(attacker, token, damage);
        break;
      }
      case 'applyDamage': {
        const updates = JSON.parse(event.target.dataset.damageUpdates);
        await bulkApplyDamageValidated(updates);
        break;
      }
      case 'painPenalty': {
        const { actorId, tokenUuid, painPenalty } = event.target.dataset;
        const token = tokenUuid ? await fromUuid(tokenUuid) : undefined;
        const actor = token ? token?.actor : await Actor.get(actorId);
        if (!actor) {
          return ui.notifications.error("The actor doesn't exist anymore");
        }

        if (canModifyTokenOrActor(token, actor)) {
          await actor.update({ 'system.painPenalty': painPenalty });
          await ChatMessage.implementation.create({
            content: 'Applied the pain penalization.',
            speaker: ChatMessage.implementation.getSpeaker({ token, actor })
          });
        }
        break;
      }
      case 'ignorePainPenalty': {
        const { actorId, tokenUuid } = event.target.dataset;
        const token = tokenUuid ? await fromUuid(tokenUuid) : undefined;
        const actor = token ? token?.actor : await Actor.get(actorId);
        if (!actor) {
          return ui.notifications.error("The actor doesn't exist anymore");
        }

        if (canModifyTokenOrActor(token, actor)) {
          if (actor.system.will.value < 1) {
            return ui.notifications.error("You don't have any Will left.");
          }

          await actor.update({ 'system.will.value': actor.system.will.value - 1 });
          await ChatMessage.implementation.create({
            content: 'It toughed through the pain with its Will power!',
            speaker: ChatMessage.implementation.getSpeaker({ token, actor })
          });
        }
        break;
      }
    }
  } catch (e) {
    ui.notifications.error(e.message);
  }
}

function createButton(mode, roll, flavor) {
  const a = document.createElement('a');
  // add classes
  a.classList.add('inline-roll');
  a.style.background = '#ddd';
  a.style.padding = '1px 4px';
  a.style.border = '1px solid var(--color-border-dark-tertiary)';
  a.style.borderRadius = '2px';
  a.style.whiteSpace = 'nowrap';
  a.style.wordBreak = 'break-all';
  a.classList.add('inline-roll-cmd');
  a.classList.add('roll');
  // add dataset
  a.dataset.mode = mode;
  a.dataset.func = 'sc';
  a.dataset.flavor = flavor ?? '';
  a.dataset.roll = roll;
  a.innerHTML = `<i class="fas fa-dice-d6"></i>${flavor ?? roll}`;
  return a;
}

async function onInlineRollClick(event) {
  event.preventDefault();
  const a = event.currentTarget;

  const flavor = a.dataset.flavor;

  switch (a.dataset.func) {
    case "sc":
      const roll = a.dataset.roll;

      const token = canvas.tokens.controlled.length > 0 ? canvas.tokens.controlled[0] : null;
      const actor = token?.actor ?? game.user?.character;
      await successRollFromExpression(a.dataset.roll, actor, { speaker: ChatMessage.implementation.getSpeaker({ token, actor }) });
      break;
  }
}


let originalProcessMessage = ChatLog.prototype.processMessage;
ChatLog.prototype.processMessage = async function (message) {
  const speaker = ChatMessage.implementation.getSpeaker();
  const chatData = {
    user: game.user.id,
    speaker
  };

  if (message.startsWith('/sc')) {
    let split = message.split(' ');
    if (split.length < 2) {
      throw new Error('This command requires 2 or more parameters');
    }

    let actor = canvas?.tokens.get(speaker?.token)?.actor ?? game.user?.character;
    return successRollFromExpression(split.slice(1).join(' '), actor, chatData);
  }

  return originalProcessMessage.call(this, message);
};

function successRollEnricher(match, options) {
  const roll = match[1];
  const flavor = match[2];
  return createButton('sc', roll, flavor);
}

/** Disable Active Effects (from https://github.com/foundryvtt/pf2e/blob/c1089180064fcfb64069ad323b2d7d522a768c06/src/module/active-effect.ts) */
export class PokeroleActiveEffect extends ActiveEffect {
  constructor(data, context) {
    data.disabled = true;
    data.transfer = false;
    super(data, context);
  }

  /** @override */
  static async createDocuments() {
    return [];
  }
}
