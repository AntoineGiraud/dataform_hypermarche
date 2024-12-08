/*************************************************************************
 *
 * @param {string} obj_path Chemin de la table/vue ex: `dataset.schema.table`
 * @returns {[string, string, string]} [db, schema, obj]
 */
function get_obj_name(obj_path) {
    let db = ''
    let schema = ''
    let obj = '';
    if (obj_path !== null && obj_path !== undefined) {
        // objet (table / vue)
        let obj_parts = obj_path.replaceAll('`', '').split('.');
        db = obj_parts[0];
        schema = obj_parts[1];
        obj = obj_parts[2];
    }
    return [db, schema, obj]
}


/*************************************************************************
 *
 * @param {string} str chaine de charactères à "slugifier"
 * @returns {string}
 */
function slugify(str) {
    return String(str)
        .normalize('NFKD') // split accented characters into their base characters and diacritical marks
        .replace(/[\u0300-\u036f]/g, '') // remove all the accents, which happen to be all in the \u03xx UNICODE block.
        .trim() // trim leading or trailing whitespace
        .toLowerCase() // convert to lowercase
        .replace(/[^a-z0-9 -]/g, '') // remove non-alphanumeric characters
        .replace(/\s+/g, '-') // replace spaces with hyphens
        .replace(/-+/g, '-'); // remove consecutive hyphens
}


/*************************************************************************
 *
 * @param {string} obj_path Chemin de la table/vue ex: `dataset.schema.table`
 * @param {string} sql      requête SQL retournant les lignes en erreur
 * @param {string} label    nom du test / CQF (contrôle qualité fonctionnel)
 * @param {boolean} est_bloquant
 * @returns {string} req SQL pour l'assertion (bloquant) OU assert généré (non bloquant)
 */
function assert_sql({ obj_path, sql, label = 'assertion failed', est_bloquant = false }) {

    const [db, schema, obj] = get_obj_name(String(obj_path));

    if (est_bloquant === true) {
        return `
-- CQF manuel bloquant
ASSERT ( 0 = (
  with t as (
    -- req SQL des lignes en erreurs
    ${sql}
  )
  select count(1) as valeur from t
)) AS "🟥  ${obj}: ${label}" ;
        `;
    } else {
        assert(obj + '_assert_' + slugify(label))
            .dependencies([obj])
            .query(sql)
        return ``;
    }
}


/*************************************************************************
 *
 * @param {string} obj_path Chemin de la table/vue ex: `dataset.schema.table`
 * @param {string} sql_date SQL du champ date ex: `date(dth_deb_conv)`
 * @param {int}    nb_derniers_jours vérif complétude sur les x derniers jours
 */
function assert_completude_derniers_jours({ obj_path, sql_date, nb_derniers_jours = 14 }) {

    const [db, schema, obj] = get_obj_name(obj_path);

    let sql = `
with plage_date as (
    select date as dt
    from unnest(generate_date_array(
        ${dataform.projectConfig.vars.date_reference} -${parseInt(nb_derniers_jours) - 1},
        ${dataform.projectConfig.vars.date_reference},
        interval 1 day
    )) as date
    order by date
), date_src as (
    select ${sql_date} as dt, count(*) as nb
    from ${obj_path}
    where ${sql_date} between ${dataform.projectConfig.vars.date_reference} -${parseInt(nb_derniers_jours) - 1} and ${dataform.projectConfig.vars.date_reference}
    group by 1
)
select plage_date.dt, coalesce(date_src.nb, 0) nb
from plage_date
  left join date_src using(dt)
where coalesce(date_src.nb, 0) = 0`

    assert(`${obj}_assert_completude_last_${parseInt(nb_derniers_jours)}_days`)
        .dependencies([obj])
        .query(sql)
    return ``;
}

/*************************************************************************
 *
 * @param {string} dev      id/code du développeur à prévenir
 * @param {string} steward  id/code du steward à prévenir
 * @returns {string} cartouche / commentaire SQL (env + dev/steward)
 */
function cartouche(args) {
    let defaults_args = { steward: null }
    let { dev, steward } = { ...defaults_args, ...args }

    return `
---- cartouche ----
-- env: ${dataform.projectConfig.vars.env}
-- dev: ${dev}
-- steward: ${steward ?? dev}
---- end-cartouche ----
`;

}

/*************************************************************************
 *
 * @param {string} nom_extrait  nom de l'extrait de données dans tableau serveur
 * @returns {string} sql permettant poussant un event au pub/sub 'refresh_tableau' afin d'actualiser tableau
 */
function refresh_tableau(nom_extrait) {
    //si on est en dév, on n'actualise pas
    if (dataform.projectConfig.vars.env !== 'prod') {
        return `-- refresh_tableau : PAS d'actualisation TABLEAU
        `;
    }

    //si on est en prod
    return `
            -- refresh_tableau : actualisons l'extrait tableau
            select bigfunctions.eu.export_to_pubsub(
                'homeserve-haiku-prod', 'refresh_tableau',
                '{"data":"${nom_extrait}"}',
                JSON'{"datasource": "${nom_extrait}", "env":"prod"}'
            ) as published_message_id ;
        `;
}


/*************************************************************************
 *
 * @param {string} nom_script  nom du script qui est chargé
 * @param {string} qui personne qui doit etre notifiée dans le message
 * @returns {string} message dans le salon Dataform Chargement
 */
function notif_chat(nom_script, qui) {

    const id_google = '<users/' + get_user_id(qui) + '>';
    const message = "👋 *" + id_google + "* \n📝 le script " + nom_script + " est *chargé* 🔋";
    const webhook = dataform.projectConfig.vars.chat_webhook;

    if (dataform.projectConfig.vars.env == 'dev') {
        return `-- notif_chat >>> pas de notification en DEV`;
    }
    return `-- notif_chat >>> notification de chargement du script
            select bigfunctions.eu.send_google_chat_message("""${message}""","${webhook}");
            `
}


/*************************************************************************
/** EXPORT DES FONCTIONS **/
module.exports = {
    get_obj_name,
    slugify,
    assert_sql,
    assert_completude_derniers_jours,
    cartouche,
    refresh_tableau,
    notif_chat
};
