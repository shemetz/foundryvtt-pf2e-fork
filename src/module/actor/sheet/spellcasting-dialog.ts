import { ActorPF2e } from "@actor";
import { AttributeString } from "@actor/types.ts";
import { SpellcastingEntryPF2e } from "@item";
import { SpellcastingEntrySource, SpellcastingEntrySystemSource } from "@item/spellcasting-entry/data.ts";
import * as R from "remeda";

function createEmptySpellcastingEntry(actor: ActorPF2e): SpellcastingEntryPF2e<ActorPF2e> {
    return new SpellcastingEntryPF2e(
        {
            name: "Untitled",
            type: "spellcastingEntry",
            system: {
                ability: { value: "cha" },
                spelldc: { value: 0, dc: 0 },
                tradition: { value: "arcane" },
                prepared: { value: "innate" },
            },
        },
        { actor },
    ) as SpellcastingEntryPF2e<ActorPF2e>;
}

/** Dialog to create or edit spellcasting entries. It works on a clone of spellcasting entry, but will not persist unless the changes are accepted */
class SpellcastingCreateAndEditDialog extends FormApplication<SpellcastingEntryPF2e<ActorPF2e>> {
    private actor: ActorPF2e;

    constructor(object: ActorPF2e | SpellcastingEntryPF2e<ActorPF2e>, options: Partial<FormApplicationOptions>) {
        super(
            object instanceof ActorPF2e ? createEmptySpellcastingEntry(object) : object.clone({}, { keepId: true }),
            options,
        );
        this.actor = object instanceof ActorPF2e ? object : object.actor;
    }

    static override get defaultOptions(): FormApplicationOptions {
        const options = super.defaultOptions;
        options.id = "spellcasting-dialog";
        options.classes = [];
        options.title = game.i18n.localize("PF2E.SpellcastingSettings.Title");
        options.template = "systems/pf2e/templates/actors/spellcasting-dialog.hbs";
        options.width = 350;
        options.submitOnChange = true;
        options.closeOnSubmit = false;
        return options;
    }

    override async getData(): Promise<SpellcastingCreateAndEditDialogSheetData> {
        const { actor } = this;

        const extraStatistics = actor.synthetics.statistics.values();
        const classDCs = actor.isOfType("character")
            ? Object.values(actor.system.proficiencies.classDCs).filter((cdc) => cdc.rank > 0)
            : [];

        const selectedStatistic = actor.getStatistic(this.object.system.proficiency.slug);

        return {
            ...(await super.getData()),
            actor,
            system: this.object.toObject().system,
            statistics: [
                ...extraStatistics,
                ...classDCs.map((c) => ({
                    slug: c.slug,
                    label: game.i18n.format("PF2E.Actor.Character.ClassDC.LabelSpecific", { class: c.label }),
                })),
            ],
            magicTraditions: CONFIG.PF2E.magicTraditions,
            spellcastingTypes: R.omit(CONFIG.PF2E.preparationType, ["ritual"]),
            attributes: CONFIG.PF2E.abilities,
            isAttributeConfigurable: this.#canSetAttribute(),
            selectedAttribute: selectedStatistic?.attribute ?? this.object.attribute,
        };
    }

    /** Returns whether or not the spellcasting data can include an ability */
    #canSetAttribute(): boolean {
        const slug = this.object._source.system.proficiency.slug;
        const baseStat = this.actor.isOfType("character") ? this.actor.getStatistic(slug) : null;
        return !slug || (!!baseStat && !baseStat.attribute);
    }

    protected override async _updateObject(event: Event, formData: Record<string, unknown>): Promise<void> {
        const wasInnate = this.object.isInnate;

        // Unflatten the form data, so that we may make some modifications
        const inputData: DeepPartial<SpellcastingEntrySource> = fu.expandObject(formData);

        // We may disable certain form data, so reinject it
        const system = fu.mergeObject(
            inputData.system ?? {},
            {
                prepared: {
                    value: this.object.system.prepared.value,
                },
                ability: { value: "cha" },
            },
            { overwrite: false },
        );

        inputData.system = system;

        // When swapping to innate convert to cha, but allow changes after
        if (system.prepared.value === "innate" && !wasInnate) {
            system.ability.value = "cha";
        }

        // If the proficiency is being set to a value, remove the selected ability
        if (system.proficiency?.slug) {
            system.ability.value = "";
        }

        if (system?.autoHeightenLevel) {
            system.autoHeightenLevel.value ||= null;
        }

        this.object.updateSource(inputData);
        this.object.reset();

        // If this wasn't a submit, only re-render and exit
        if (event.type !== "submit") {
            await this.render();
            return;
        }

        return this.updateAndClose();
    }

    private async updateAndClose(): Promise<void> {
        const updateData = this.object.toObject();

        if (this.object.isRitual) {
            updateData.system.tradition.value = "";
            updateData.system.ability.value = "";
        }

        if (!this.object.isPrepared) {
            delete updateData.system.prepared.flexible;
        }

        if (this.object.id === null) {
            updateData.name = (() => {
                const preparationType =
                    game.i18n.localize(CONFIG.PF2E.preparationType[updateData.system.prepared.value]) ?? "";
                const magicTraditions: Record<string, string> = CONFIG.PF2E.magicTraditions;
                const traditionSpells = game.i18n.localize(magicTraditions[this.object.tradition ?? ""]);
                if (this.object.isRitual || !traditionSpells) {
                    return preparationType;
                } else {
                    return game.i18n.format("PF2E.SpellCastingFormat", { preparationType, traditionSpells });
                }
            })();

            await this.actor.createEmbeddedDocuments("Item", [updateData]);
        } else {
            const actualEntry = this.actor.spellcasting.get(this.object.id);
            if (!(actualEntry instanceof SpellcastingEntryPF2e)) return;

            const system = R.pick(updateData.system, [
                "prepared",
                "tradition",
                "ability",
                "proficiency",
                "autoHeightenLevel",
            ]);
            await actualEntry.update({ system });
        }

        this.close();
    }
}

interface SpellcastingCreateAndEditDialogSheetData extends FormApplicationData<SpellcastingEntryPF2e<ActorPF2e>> {
    actor: ActorPF2e;
    system: SpellcastingEntrySystemSource;
    magicTraditions: ConfigPF2e["PF2E"]["magicTraditions"];
    statistics: { slug: string; label: string }[];
    spellcastingTypes: Omit<ConfigPF2e["PF2E"]["preparationType"], "ritual">;
    attributes: ConfigPF2e["PF2E"]["abilities"];
    isAttributeConfigurable: boolean;
    selectedAttribute: AttributeString;
}

export async function createSpellcastingDialog(
    event: MouseEvent,
    object: ActorPF2e | SpellcastingEntryPF2e<ActorPF2e>,
): Promise<SpellcastingCreateAndEditDialog> {
    const dialog = new SpellcastingCreateAndEditDialog(object, {
        top: event.clientY - 80,
        left: window.innerWidth - 710,
        height: "auto",
    });
    return dialog.render(true);
}
