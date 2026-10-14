package lila.user

import scala.concurrent.ExecutionContext.Implicits.global

import org.specs2.mutable.Specification

import lila.common.EmailAddress
import lila.common.config.Secret

class EmailFreeUserTest extends Specification {

  private val repo = new UserRepo(null)
  private val auth = new Authenticator(new PasswordHasher(Secret(Array.fill(32)(1.toByte).toBase64), 2), repo)
  private val password = User.ClearPassword("correct-password")
  private val hash = auth.passEnc(password)

  "a user document without an email" should {
    "omit email and confirmation fields while retaining authentication data" in {
      val doc = repo.newUser("NoMailUser", hash, None, blind = false, mustConfirmEmail = false, lang = None)
      val fields = doc.elements.map(_.name).toSet
      fields must not(contain("email"))
      fields must not(contain("verbatimEmail"))
      fields must not(contain("mustConfirmEmail"))
      fields must contain("bpass")
      doc.getAsOpt[String]("_id") must beSome("nomailuser")
      User.userBSONHandler.readDocument(doc).isSuccess must beTrue
      auth.compare(Authenticator.AuthData("nomailuser", bpass = hash), password) must beTrue
    }
    "preserve the existing email document format for internal legacy callers" in {
      val doc = repo.newUser("LegacyUser", hash, Some(EmailAddress("USER@example.test")),
        blind = false, mustConfirmEmail = true, lang = None)
      doc.getAsOpt[String]("email") must beSome("user@example.test")
      doc.getAsOpt[String]("verbatimEmail") must beSome("USER@example.test")
      doc.elements.map(_.name) must contain("mustConfirmEmail")
    }
  }
}
