# Guide complet A → Z : installer le mod multijoueur sur le jeu (MT Manager)

Ce guide part du principe que Jules a terminé les Tâches 1 à 3 et que les
workflows GitHub Actions du repo `protonbusgg` sont verts. Il ne modifie
JAMAIS `libmain.so` d'origine — tout passe par l'installeur officiel
LemonLoader (documenté, versionné), pas par un patch ELF manuel.

⚠️ **Un point n'est pas encore garanti à 100%** et doit être confirmé par
Jules avant de considérer le code "fini" — voir l'encadré en bas de la
Section 3. Ne saute pas cette vérification.

---

## Section 0 — Sauvegardes (avant tout)

1. Sauvegarde `PBSU_1300.apk` d'origine (non modifié) quelque part en sécurité.
2. Si le jeu a une sauvegarde de progression locale, exporte-la si possible
   (le patcheur LemonLoader gère en théorie ça automatiquement, mais un
   double filet de sécurité ne coûte rien).

## Section 1 — Récupérer les fichiers compilés

Depuis le repo `protonbusgg` (dossier `dist/`) une fois les workflows verts :

- `libmod-armeabi-v7a.so`
- `libc++_shared-armeabi-v7a.so`
- `ProtonBusSyncMod.dll`

Télécharge les 3 sur ton téléphone (bouton "..." sur GitHub mobile → Download,
ou ouvrir le fichier → "Raw" → "Enregistrer sous").

## Section 2 — Installer LemonLoader (Android) sur le jeu

1. Récupère l'installeur LemonLoader Android depuis le dépôt officiel
   `github.com/LemonLoader/MelonLoader` (section Releases) — c'est une
   application/outil à installer sur le téléphone, distinct du jeu.
2. Lance l'installeur, sélectionne `PBSU_1300.apk` (ou le jeu déjà installé,
   selon le mode proposé par l'installeur).
3. Laisse l'installeur patcher le jeu — c'est lui qui gère le remplacement
   contrôlé de `libmain.so` par son propre mécanisme (pas un `patchelf` fait à
   la main), l'ajout des permissions nécessaires, et la sauvegarde
   automatique de `/data/` et `/obb/` si le jeu en a.
4. Une fois le patch terminé, installe l'APK patché produit par l'installeur.
5. Lance le jeu patché **une première fois** pour que LemonLoader génère son
   arborescence de dossiers dans `/sdcard/Android/data/<package_du_jeu>/files/`
   (au moins `Mods/`, `Plugins/`, `MelonLoader/`).

## Section 3 — Placer les 3 fichiers

1. **`ProtonBusSyncMod.dll`** → dossier `Mods/` (confirmé, c'est l'emplacement
   standard MelonLoader/LemonLoader pour tout mod C#).
2. **`libmod-armeabi-v7a.so`** (renommé `libmod.so`) et
   **`libc++_shared-armeabi-v7a.so`** (renommé `libc++_shared.so`) :

   > ⚠️ **À CONFIRMER avant de considérer le mod fonctionnel** — LemonLoader a
   > une classe `NativeLibrary` prévue spécifiquement pour charger des `.so`
   > qui ne sont pas embarqués dans l'APK d'origine (au lieu de compter sur le
   > chargement automatique via `lib/armeabi-v7a/`). Il existe aussi une
   > convention `assets/copyToData` (un fichier placé à
   > `assets/copyToData/Mods/xxx` dans l'APK est automatiquement copié vers
   > `/sdcard/Android/data/<package>/files/Mods/xxx` au patch). Concrètement,
   > ça veut dire que `[DllImport("mod")]` tel qu'écrit actuellement dans
   > `ProtonBusSyncMod.cs` **pourrait ne pas trouver `libmod.so`** s'il n'est
   > pas dans le chemin de recherche standard des libs natives du process.
   > **Demande à Jules de vérifier ce point précis** (classe `NativeLibrary`
   > dans le code source de LemonLoader, ou son wiki) et d'adapter le
   > chargement de `libmod.so` en conséquence si besoin, avant de considérer
   > cette étape comme "juste copier-coller les fichiers".

3. Relance le jeu.

## Section 4 — Vérifier que ça tourne

- `MelonLoader/Latest.log` (dans le dossier de données de l'app) doit
  contenir dans l'ordre :
  ```
  [ProtonBusSync] Démarrage du mod, initialisation native en arrière-plan...
  [ProtonBusSync] native_init() a démarré sans exception.
  ```
- Le menu Offline/Online (Tâche 3) doit apparaître au lancement.
- `https://tafitaniaina-tvserveur.hf.space/api/stats` (ou l'URL du serveur mis
  à jour si `Protonbusserveur` diffère) doit monter à 1 connexion une fois
  connecté en mode Online.

Si tu vois `libmod.so introuvable...` dans les logs → c'est précisément le
point ⚠️ de la Section 3 qui n'est pas encore correctement réglé. Reviens vers
moi ou vers Jules avec le message d'erreur exact avant d'essayer d'autres
emplacements au hasard.

## Section 5 — Test à trois

Chacun de tes deux frères répète les Sections 1, 2 (sur SA propre copie
légitime du jeu) et 3 sur son propre téléphone. Même room, même map/bus →
vous devez vous voir bouger dans le jeu.
