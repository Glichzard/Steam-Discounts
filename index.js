const mysql = require("mysql");
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const passport = require("passport");

dotenv.config();

const app = express();
const port = process.env.EXPRESS_PORT;

app.use(express.json());
app.use(cors());
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_REDIRECT_URI,
            scope: ["email", "profile"],
        },
        (accessToken, refreshToken, profile, done) => {
            const email = profile.emails[0].value;
            const name = profile.displayName;
            const photo = profile.photos[0].value;

            done(null, { email, name, photo });
        }
    )
);

const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});
const connection = mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DATABASE,
});

connection.connect((error) => {
    if (error) {
        console.error("Error de conexión a MySQL:", error);
        throw error;
    }
    console.log("Conexión a MySQL establecida correctamente");
});

const API_KEY = process.env.GOOGLE_API_KEY;
const ENGINE = process.env.GOOGLE_ENGINE;

app.get("/search/:game", async (req, res) => {
    try {
        const GAME = req.params.game;

        const result = await fetch(
            `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${ENGINE}&q=${GAME}`
        ).then((response) => response.json());

        if (!result.items) {
            throw "No hay resultados";
        }

        const results = [];

        await Promise.all(
            result.items.map(async (element) => {
                console.log(element.link);
                if (element.link.split("/")[3] === "app") {
                    results.push(await openWebPage(element.link));
                }
            })
        );

        console.log(results);
        res.json(results);
    } catch (error) {
        console.log("error", error);
        res.status(500).json({ error: "Error en el servidor" });
    }
});

app.get("/mail", async (req, res) => {
    let mailOptions = {
        from: process.env.GMAIL_USER,
        to: "guillemartin1412@gmail.com",
        subject: "El juego (juego) esta en descuento",
        text: "Cuerpo del correo electrónico",
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log(error);
        }
        console.log("Correo electrónico enviado:", info.response);
    });
});

app.get(
    "/auth/google",
    passport.authenticate("google", { scope: ["email", "profile"] })
);

app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/" }),
    (req, res) => {
        const { email, name, photo } = req.user;
        res.redirect(
            `http://localhost/login.html/?name=${encodeURIComponent(
                name
            )}&email=${encodeURIComponent(email)}&photo=${encodeURIComponent(
                photo
            )}`
        );
    }
);

const openWebPage = async (link) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto("https://store.steampowered.com");

    await page.setCookie({
        name: "birthtime",
        value: "817783201",
        domain: "store.steampowered.com",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "None",
    });
    await page.setCookie({
        name: "wants_mature_content",
        value: "1",
        domain: "store.steampowered.com",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "None",
    });

    await page.goto(link);

    console.log("Trabajando con: " + (await page.url()));

    const info = await page.evaluate(() => {
        const title = document.querySelector(
            "div#appHubAppName.apphub_AppName"
        ).innerText;
        const image = document.querySelector("img.game_header_image_full").src;
        return {
            title,
            image,
        };
    });

    const prices = await page.evaluate(() => {
        const pricesList = [];
        const areaPurchaseCount = document
            .querySelector(".game_description_column")
            .querySelectorAll(
                ".game_area_purchase_game:not(.game_area_purchase_game_dropdown_subscription)"
            ).length;

        for (let i = 0; i < areaPurchaseCount; i++) {
            const purchase = document
                .querySelector(".game_description_column")
                .querySelectorAll(".game_area_purchase_game")
                [i].querySelector(".game_purchase_action_bg");

            if (purchase.childElementCount == 1) {
                pricesList.push({
                    title: document
                        .querySelector(".game_description_column")
                        .querySelectorAll(".game_area_purchase_game")
                        [i].querySelector("h1").innerHTML,
                    original: "Free",
                    finally: 0,
                    discount: 0,
                });
            }
            if (purchase.childElementCount > 1) {
                const getPrice = document
                    .querySelector(".game_description_column")
                    .querySelectorAll(".game_area_purchase_game")
                    [i].querySelector(".game_purchase_action_bg").children[0];
                if (getPrice.childElementCount == 0) {
                    pricesList.push({
                        title: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector("h1").innerHTML,
                        original: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].innerText,
                        finally: 0,
                        discount: 0,
                    });
                }
                if (getPrice.childElementCount > 0) {
                    pricesList.push({
                        title: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector("h1").innerHTML,
                        original: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].querySelector(
                                ".discount_original_price"
                            ).innerText,
                        finally: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].querySelector(".discount_final_price")
                            .innerText,
                        discount: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].querySelector(".discount_pct")
                            .innerText,
                    });
                }
            }
        }

        return pricesList;
    });

    await browser.close();

    console.log(info);

    return {
        link,
        info,
        prices,
    };
};

app.listen(port, () => {
    console.log(`Servidor Express escuchando en el puerto ${port}`);
});
